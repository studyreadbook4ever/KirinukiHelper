#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0601
#define UNICODE
#define _UNICODE

#include <windows.h>
#include <tlhelp32.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>

#define KIRINUKI_JOB_LAUNCHER_CONTRACT L"kirinuki/windows-job-launcher/v1"
#define KIRINUKI_MAX_COMMAND_LINE_CHARS 32767U
#define KIRINUKI_MAX_INHERITED_DESCRIPTORS 2048
#define KIRINUKI_CRT_FOPEN 0x01U

enum kirinuki_launcher_exit_code {
  KIRINUKI_EXIT_USAGE = 240,
  KIRINUKI_EXIT_PARENT_IDENTITY = 241,
  KIRINUKI_EXIT_PARENT_GONE = 242,
  KIRINUKI_EXIT_JOB_SETUP = 243,
  KIRINUKI_EXIT_CHILD_CREATE = 244,
  KIRINUKI_EXIT_CHILD_ASSIGN = 245,
  KIRINUKI_EXIT_CHILD_RESUME = 246,
  KIRINUKI_EXIT_WAIT = 247,
  KIRINUKI_EXIT_CHILD_STATUS = 248,
  KIRINUKI_EXIT_STDIO_CONTRACT = 249
};

struct command_line_builder {
  wchar_t *value;
  size_t length;
  size_t capacity;
};

struct inherited_handle_set {
  HANDLE *values;
  SIZE_T count;
  SIZE_T capacity;
};

static void report_windows_error(const wchar_t *stage, DWORD error_code) {
  (void)fwprintf(
    stderr,
    L"Kirinuki Job Object launcher: %ls failed (win32=%lu).\n",
    stage,
    (unsigned long)error_code
  );
  (void)fflush(stderr);
}

static BOOL parse_process_id(const wchar_t *value, DWORD *result) {
  uint64_t parsed = 0U;
  size_t index;

  if (value == NULL || value[0] == L'\0' || result == NULL) {
    return FALSE;
  }
  for (index = 0U; value[index] != L'\0'; index += 1U) {
    if (value[index] < L'0' || value[index] > L'9') {
      return FALSE;
    }
    parsed = parsed * 10U + (uint64_t)(value[index] - L'0');
    if (parsed > 0xffffffffULL) {
      return FALSE;
    }
  }
  if (index > 10U || (index > 1U && value[0] == L'0')) {
    return FALSE;
  }
  if (
    parsed == 0U
    || parsed > 0xffffffffULL
  ) {
    return FALSE;
  }
  *result = (DWORD)parsed;
  return TRUE;
}

static DWORD actual_parent_process_id(void) {
  const DWORD current_process_id = GetCurrentProcessId();
  HANDLE snapshot;
  PROCESSENTRY32W entry;
  DWORD parent_process_id = 0U;

  snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0U);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return 0U;
  }
  ZeroMemory(&entry, sizeof(entry));
  entry.dwSize = (DWORD)sizeof(entry);
  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (entry.th32ProcessID == current_process_id) {
        parent_process_id = entry.th32ParentProcessID;
        break;
      }
    } while (Process32NextW(snapshot, &entry));
  }
  (void)CloseHandle(snapshot);
  return parent_process_id;
}

static HANDLE open_verified_parent(DWORD requested_parent_id) {
  HANDLE parent_process;
  FILETIME parent_created;
  FILETIME parent_exited;
  FILETIME parent_kernel;
  FILETIME parent_user;
  FILETIME launcher_created;
  FILETIME launcher_exited;
  FILETIME launcher_kernel;
  FILETIME launcher_user;
  DWORD actual_parent_id = actual_parent_process_id();

  if (actual_parent_id == 0U || actual_parent_id != requested_parent_id) {
    return NULL;
  }
  parent_process = OpenProcess(
    SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
    FALSE,
    requested_parent_id
  );
  if (parent_process == NULL) {
    return NULL;
  }
  if (
    WaitForSingleObject(parent_process, 0U) != WAIT_TIMEOUT
    || !GetProcessTimes(
      parent_process,
      &parent_created,
      &parent_exited,
      &parent_kernel,
      &parent_user
    )
    || !GetProcessTimes(
      GetCurrentProcess(),
      &launcher_created,
      &launcher_exited,
      &launcher_kernel,
      &launcher_user
    )
    || CompareFileTime(&parent_created, &launcher_created) > 0
  ) {
    (void)CloseHandle(parent_process);
    return NULL;
  }
  return parent_process;
}

static BOOL append_character(struct command_line_builder *builder, wchar_t value) {
  if (
    builder == NULL
    || builder->value == NULL
    || builder->length + 1U >= builder->capacity
  ) {
    return FALSE;
  }
  builder->value[builder->length] = value;
  builder->length += 1U;
  builder->value[builder->length] = L'\0';
  return TRUE;
}

static BOOL append_repeated(
  struct command_line_builder *builder,
  wchar_t value,
  size_t count
) {
  size_t index;
  for (index = 0U; index < count; index += 1U) {
    if (!append_character(builder, value)) {
      return FALSE;
    }
  }
  return TRUE;
}

/* Implements the inverse of the CommandLineToArgvW/MSVCRT quoting rules. */
static BOOL append_quoted_argument(
  struct command_line_builder *builder,
  const wchar_t *argument
) {
  size_t index = 0U;
  size_t backslashes = 0U;

  if (argument == NULL || !append_character(builder, L'"')) {
    return FALSE;
  }
  while (argument[index] != L'\0') {
    if (argument[index] == L'\\') {
      backslashes += 1U;
      index += 1U;
      continue;
    }
    if (argument[index] == L'"') {
      if (
        !append_repeated(builder, L'\\', backslashes * 2U + 1U)
        || !append_character(builder, L'"')
      ) {
        return FALSE;
      }
      backslashes = 0U;
      index += 1U;
      continue;
    }
    if (
      !append_repeated(builder, L'\\', backslashes)
      || !append_character(builder, argument[index])
    ) {
      return FALSE;
    }
    backslashes = 0U;
    index += 1U;
  }
  return append_repeated(builder, L'\\', backslashes * 2U)
    && append_character(builder, L'"');
}

static wchar_t *build_child_command_line(
  int argument_count,
  wchar_t **arguments,
  int first_child_argument
) {
  struct command_line_builder builder;
  int index;

  builder.value = (wchar_t *)calloc(
    (size_t)KIRINUKI_MAX_COMMAND_LINE_CHARS + 1U,
    sizeof(wchar_t)
  );
  if (builder.value == NULL) {
    return NULL;
  }
  builder.length = 0U;
  builder.capacity = (size_t)KIRINUKI_MAX_COMMAND_LINE_CHARS + 1U;
  for (index = first_child_argument; index < argument_count; index += 1) {
    if (
      (index > first_child_argument && !append_character(&builder, L' '))
      || !append_quoted_argument(&builder, arguments[index])
    ) {
      free(builder.value);
      return NULL;
    }
  }
  return builder.value;
}

static BOOL validate_absolute_regular_executable(const wchar_t *file_path) {
  wchar_t *canonical = NULL;
  DWORD required;
  DWORD written;
  DWORD attributes;
  size_t length;
  size_t index;
  BOOL valid = FALSE;

  if (file_path == NULL || file_path[0] == L'\0') {
    return FALSE;
  }
  length = wcslen(file_path);
  if (
    length == 0U
    || length >= (size_t)KIRINUKI_MAX_COMMAND_LINE_CHARS
    || iswspace(file_path[0])
    || iswspace(file_path[length - 1U])
  ) {
    return FALSE;
  }
  for (index = 0U; index < length; index += 1U) {
    if (file_path[index] < 0x20 || file_path[index] == 0x7f) {
      return FALSE;
    }
  }
  required = GetFullPathNameW(file_path, 0U, NULL, NULL);
  if (required == 0U || required > KIRINUKI_MAX_COMMAND_LINE_CHARS) {
    return FALSE;
  }
  canonical = (wchar_t *)calloc((size_t)required, sizeof(wchar_t));
  if (canonical == NULL) {
    return FALSE;
  }
  written = GetFullPathNameW(file_path, required, canonical, NULL);
  if (
    written > 0U
    && written < required
    && _wcsicmp(file_path, canonical) == 0
  ) {
    attributes = GetFileAttributesW(canonical);
    valid = attributes != INVALID_FILE_ATTRIBUTES
      && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0U
      && (attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0U
      && (attributes & FILE_ATTRIBUTE_DEVICE) == 0U;
  }
  free(canonical);
  return valid;
}

static BOOL add_inherited_handle(
  struct inherited_handle_set *handles,
  HANDLE handle
) {
  DWORD flags = 0U;
  SIZE_T index;
  if (handle == NULL || handle == INVALID_HANDLE_VALUE) {
    return TRUE;
  }
  if (handles == NULL || handles->values == NULL) {
    return FALSE;
  }
  for (index = 0U; index < handles->count; index += 1U) {
    if (handles->values[index] == handle) {
      return TRUE;
    }
  }
  if (handles->count >= handles->capacity) {
    return FALSE;
  }
  if (!GetHandleInformation(handle, &flags)) {
    return FALSE;
  }
  if (
    (flags & HANDLE_FLAG_INHERIT) == 0U
    &&
    !SetHandleInformation(
      handle,
      HANDLE_FLAG_INHERIT,
      HANDLE_FLAG_INHERIT
    )
  ) {
    return FALSE;
  }
  handles->values[handles->count] = handle;
  handles->count += 1U;
  return TRUE;
}

/*
 * Node/libuv maps fd 3 through STARTUPINFO.cbReserved2/lpReserved2. Preserve
 * only CRT descriptors 0..3: stdout/stderr and the explicit handle-bound
 * ffprobe input. Any additional descriptor fails closed instead of expanding
 * the child handle authority.
 */
static BOOL validate_and_prepare_inherited_descriptors(
  const STARTUPINFOW *source_startup,
  struct inherited_handle_set *handles
) {
  int descriptor_count;
  size_t minimum_bytes;
  size_t flags_offset = sizeof(int);
  size_t handles_offset;
  int index;

  if (source_startup == NULL) {
    return FALSE;
  }
  if ((source_startup->dwFlags & STARTF_USESTDHANDLES) != 0U) {
    if (
      !add_inherited_handle(handles, source_startup->hStdInput)
      || !add_inherited_handle(handles, source_startup->hStdOutput)
      || !add_inherited_handle(handles, source_startup->hStdError)
    ) {
      return FALSE;
    }
  }
  if (source_startup->cbReserved2 == 0U) {
    return TRUE;
  }
  if (
    source_startup->lpReserved2 == NULL
    || source_startup->cbReserved2 < (WORD)sizeof(int)
  ) {
    return FALSE;
  }
  (void)memcpy(
    &descriptor_count,
    source_startup->lpReserved2,
    sizeof(descriptor_count)
  );
  if (
    descriptor_count < 0
    || descriptor_count > KIRINUKI_MAX_INHERITED_DESCRIPTORS
  ) {
    return FALSE;
  }
  handles_offset = flags_offset + (size_t)descriptor_count;
  minimum_bytes = handles_offset
    + (size_t)descriptor_count * sizeof(intptr_t);
  if (minimum_bytes > (size_t)source_startup->cbReserved2) {
    return FALSE;
  }
  for (index = 0; index < descriptor_count; index += 1) {
    const unsigned char descriptor_flags =
      source_startup->lpReserved2[flags_offset + (size_t)index];
    intptr_t raw_handle = (intptr_t)-1;
    if ((descriptor_flags & KIRINUKI_CRT_FOPEN) == 0U) {
      continue;
    }
    if (index > 3) {
      return FALSE;
    }
    (void)memcpy(
      &raw_handle,
      source_startup->lpReserved2
        + handles_offset
        + (size_t)index * sizeof(intptr_t),
      sizeof(raw_handle)
    );
    if (
      raw_handle != (intptr_t)-1
      && !add_inherited_handle(handles, (HANDLE)raw_handle)
    ) {
      return FALSE;
    }
  }
  return TRUE;
}

static void terminate_unassigned_child(PROCESS_INFORMATION *child) {
  if (child == NULL) {
    return;
  }
  if (child->hProcess != NULL) {
    (void)TerminateProcess(child->hProcess, KIRINUKI_EXIT_CHILD_ASSIGN);
    (void)WaitForSingleObject(child->hProcess, 10000U);
  }
  if (child->hThread != NULL) {
    (void)CloseHandle(child->hThread);
    child->hThread = NULL;
  }
  if (child->hProcess != NULL) {
    (void)CloseHandle(child->hProcess);
    child->hProcess = NULL;
  }
}

int wmain(int argument_count, wchar_t **arguments) {
  DWORD requested_parent_id = 0U;
  HANDLE parent_process = NULL;
  HANDLE job = NULL;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION job_limits;
  STARTUPINFOW inherited_startup;
  STARTUPINFOEXW child_startup;
  PROCESS_INFORMATION child;
  struct inherited_handle_set inherited_handles;
  SIZE_T attribute_list_bytes = 0U;
  wchar_t *child_command_line = NULL;
  DWORD creation_flags = CREATE_SUSPENDED
    | CREATE_UNICODE_ENVIRONMENT
    | CREATE_NO_WINDOW
    | EXTENDED_STARTUPINFO_PRESENT;
  DWORD wait_result;
  DWORD child_exit_code = 0U;
  HANDLE wait_handles[2];

  (void)SetErrorMode(
    SEM_FAILCRITICALERRORS
      | SEM_NOGPFAULTERRORBOX
      | SEM_NOOPENFILEERRORBOX
  );
  if (
    argument_count == 2
    && wcscmp(arguments[1], L"--contract") == 0
  ) {
    (void)fwprintf(stdout, L"%ls\n", KIRINUKI_JOB_LAUNCHER_CONTRACT);
    (void)fflush(stdout);
    return 0;
  }
  if (
    argument_count < 5
    || wcscmp(arguments[1], L"--parent-pid") != 0
    || !parse_process_id(arguments[2], &requested_parent_id)
    || wcscmp(arguments[3], L"--") != 0
    || !validate_absolute_regular_executable(arguments[4])
  ) {
    return KIRINUKI_EXIT_USAGE;
  }

  parent_process = open_verified_parent(requested_parent_id);
  if (parent_process == NULL) {
    report_windows_error(L"parent identity", GetLastError());
    return KIRINUKI_EXIT_PARENT_IDENTITY;
  }

  job = CreateJobObjectW(NULL, NULL);
  if (job == NULL) {
    report_windows_error(L"CreateJobObjectW", GetLastError());
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_JOB_SETUP;
  }
  (void)SetHandleInformation(job, HANDLE_FLAG_INHERIT, 0U);
  ZeroMemory(&job_limits, sizeof(job_limits));
  job_limits.BasicLimitInformation.LimitFlags =
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (
    !SetInformationJobObject(
      job,
      JobObjectExtendedLimitInformation,
      &job_limits,
      (DWORD)sizeof(job_limits)
    )
  ) {
    report_windows_error(L"SetInformationJobObject", GetLastError());
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_JOB_SETUP;
  }

  ZeroMemory(&inherited_startup, sizeof(inherited_startup));
  inherited_startup.cb = (DWORD)sizeof(inherited_startup);
  GetStartupInfoW(&inherited_startup);
  ZeroMemory(&inherited_handles, sizeof(inherited_handles));
  inherited_handles.capacity = (SIZE_T)KIRINUKI_MAX_INHERITED_DESCRIPTORS + 3U;
  inherited_handles.values = (HANDLE *)HeapAlloc(
    GetProcessHeap(),
    HEAP_ZERO_MEMORY,
    inherited_handles.capacity * sizeof(HANDLE)
  );
  if (
    inherited_handles.values == NULL
    || !validate_and_prepare_inherited_descriptors(
      &inherited_startup,
      &inherited_handles
    )
    || inherited_handles.count == 0U
  ) {
    report_windows_error(L"inherited stdio contract", GetLastError());
    if (inherited_handles.values != NULL) {
      (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
    }
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_STDIO_CONTRACT;
  }
  ZeroMemory(&child_startup, sizeof(child_startup));
  child_startup.StartupInfo.cb = (DWORD)sizeof(child_startup);
  child_startup.StartupInfo.dwFlags = inherited_startup.dwFlags
    & (STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW);
  child_startup.StartupInfo.wShowWindow = inherited_startup.wShowWindow;
  child_startup.StartupInfo.hStdInput = inherited_startup.hStdInput;
  child_startup.StartupInfo.hStdOutput = inherited_startup.hStdOutput;
  child_startup.StartupInfo.hStdError = inherited_startup.hStdError;
  child_startup.StartupInfo.cbReserved2 = inherited_startup.cbReserved2;
  child_startup.StartupInfo.lpReserved2 = inherited_startup.lpReserved2;
  if (
    InitializeProcThreadAttributeList(NULL, 1U, 0U, &attribute_list_bytes)
    || GetLastError() != ERROR_INSUFFICIENT_BUFFER
    || attribute_list_bytes == 0U
  ) {
    report_windows_error(L"InitializeProcThreadAttributeList(size)", GetLastError());
    (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_STDIO_CONTRACT;
  }
  child_startup.lpAttributeList = (LPPROC_THREAD_ATTRIBUTE_LIST)HeapAlloc(
    GetProcessHeap(),
    HEAP_ZERO_MEMORY,
    attribute_list_bytes
  );
  if (child_startup.lpAttributeList == NULL) {
    report_windows_error(L"HeapAlloc(attribute list)", GetLastError());
    (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_STDIO_CONTRACT;
  }
  if (!InitializeProcThreadAttributeList(
      child_startup.lpAttributeList,
      1U,
      0U,
      &attribute_list_bytes
    )) {
    report_windows_error(L"InitializeProcThreadAttributeList", GetLastError());
    (void)HeapFree(GetProcessHeap(), 0U, child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_STDIO_CONTRACT;
  }
  if (!UpdateProcThreadAttribute(
      child_startup.lpAttributeList,
      0U,
      PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
      inherited_handles.values,
      inherited_handles.count * sizeof(HANDLE),
      NULL,
      NULL
    )) {
    report_windows_error(L"PROC_THREAD_ATTRIBUTE_HANDLE_LIST", GetLastError());
    DeleteProcThreadAttributeList(child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_STDIO_CONTRACT;
  }
  child_command_line = build_child_command_line(argument_count, arguments, 4);
  if (child_command_line == NULL) {
    DeleteProcThreadAttributeList(child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_USAGE;
  }
  if (WaitForSingleObject(parent_process, 0U) != WAIT_TIMEOUT) {
    free(child_command_line);
    DeleteProcThreadAttributeList(child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_PARENT_GONE;
  }

  ZeroMemory(&child, sizeof(child));
  if (
    !CreateProcessW(
      arguments[4],
      child_command_line,
      NULL,
      NULL,
      TRUE,
      creation_flags,
      NULL,
      NULL,
      &child_startup.StartupInfo,
      &child
    )
  ) {
    report_windows_error(L"CreateProcessW(CREATE_SUSPENDED)", GetLastError());
    free(child_command_line);
    DeleteProcThreadAttributeList(child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, child_startup.lpAttributeList);
    (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_CHILD_CREATE;
  }
  free(child_command_line);
  child_command_line = NULL;
  DeleteProcThreadAttributeList(child_startup.lpAttributeList);
  (void)HeapFree(GetProcessHeap(), 0U, child_startup.lpAttributeList);
  child_startup.lpAttributeList = NULL;
  (void)HeapFree(GetProcessHeap(), 0U, inherited_handles.values);
  inherited_handles.values = NULL;

  if (!AssignProcessToJobObject(job, child.hProcess)) {
    report_windows_error(L"AssignProcessToJobObject", GetLastError());
    terminate_unassigned_child(&child);
    (void)CloseHandle(job);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_CHILD_ASSIGN;
  }
  if (WaitForSingleObject(parent_process, 0U) != WAIT_TIMEOUT) {
    (void)CloseHandle(child.hThread);
    child.hThread = NULL;
    (void)TerminateJobObject(job, KIRINUKI_EXIT_PARENT_GONE);
    (void)CloseHandle(job);
    (void)WaitForSingleObject(child.hProcess, 10000U);
    (void)CloseHandle(child.hProcess);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_PARENT_GONE;
  }
  if (ResumeThread(child.hThread) == (DWORD)-1) {
    report_windows_error(L"ResumeThread", GetLastError());
    (void)CloseHandle(child.hThread);
    child.hThread = NULL;
    (void)TerminateJobObject(job, KIRINUKI_EXIT_CHILD_RESUME);
    (void)CloseHandle(job);
    (void)WaitForSingleObject(child.hProcess, 10000U);
    (void)CloseHandle(child.hProcess);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_CHILD_RESUME;
  }
  (void)CloseHandle(child.hThread);
  child.hThread = NULL;

  wait_handles[0] = parent_process;
  wait_handles[1] = child.hProcess;
  wait_result = WaitForMultipleObjects(2U, wait_handles, FALSE, INFINITE);
  if (
    wait_result == WAIT_OBJECT_0 + 1U
    || (
      wait_result == WAIT_OBJECT_0
      && WaitForSingleObject(child.hProcess, 0U) == WAIT_OBJECT_0
    )
  ) {
    if (!GetExitCodeProcess(child.hProcess, &child_exit_code)) {
      report_windows_error(L"GetExitCodeProcess", GetLastError());
      (void)TerminateJobObject(job, KIRINUKI_EXIT_CHILD_STATUS);
      (void)CloseHandle(job);
      (void)CloseHandle(child.hProcess);
      (void)CloseHandle(parent_process);
      return KIRINUKI_EXIT_CHILD_STATUS;
    }
    (void)CloseHandle(child.hProcess);
    (void)CloseHandle(parent_process);
    /* Closing the sole Job handle also removes any descendants left behind. */
    (void)CloseHandle(job);
    ExitProcess(child_exit_code);
  }
  if (wait_result == WAIT_OBJECT_0) {
    (void)TerminateJobObject(job, KIRINUKI_EXIT_PARENT_GONE);
    (void)CloseHandle(job);
    if (WaitForSingleObject(child.hProcess, 10000U) == WAIT_TIMEOUT) {
      (void)TerminateProcess(child.hProcess, KIRINUKI_EXIT_PARENT_GONE);
      (void)WaitForSingleObject(child.hProcess, 10000U);
    }
    (void)CloseHandle(child.hProcess);
    (void)CloseHandle(parent_process);
    return KIRINUKI_EXIT_PARENT_GONE;
  }

  report_windows_error(L"WaitForMultipleObjects", GetLastError());
  (void)TerminateJobObject(job, KIRINUKI_EXIT_WAIT);
  (void)CloseHandle(job);
  (void)WaitForSingleObject(child.hProcess, 10000U);
  (void)CloseHandle(child.hProcess);
  (void)CloseHandle(parent_process);
  return KIRINUKI_EXIT_WAIT;
}
