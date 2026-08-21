!ifdef BUILD_UNINSTALLER
!macro customCheckAppRunning
  # electron-builder's default silent-uninstall preflight terminates the
  # application by image name before customUnInstall runs. Give the exact
  # installed engine its owned cleanup command first so the gateway,
  # autostart entry, and retained media processes shut down gracefully.
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 kirinuki_preflight_cleanup_complete
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --kirinuki-internal-owned-uninstall' $0
  StrCmp $0 "0" kirinuki_preflight_cleanup_complete
  Abort "Kirinuki Local Engine is still running. Close it and retry uninstall."

kirinuki_preflight_cleanup_complete:
!macroend
!endif

!macro customInit
  # Refuse an ambiguous pre-existing handler before any application files are
  # changed. An exact handler is an idempotent same-path reinstall; a wholly
  # absent registration is a clean first install. Partial/foreign state is not
  # enough evidence for this installer to claim ownership.
  ClearErrors
  ReadRegStr $0 HKCU "Software\Classes\kirinuki-engine\shell\open\command" ""
  IfErrors kirinuki_protocol_preflight_no_command
  StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' kirinuki_protocol_preflight_owned_root
  Abort "Another application owns the kirinuki-engine protocol."

kirinuki_protocol_preflight_owned_root:
  ClearErrors
  ReadRegStr $1 HKCU "Software\Classes\kirinuki-engine" ""
  IfErrors kirinuki_protocol_preflight_incomplete
  StrCmp $1 "URL:kirinuki-engine" 0 kirinuki_protocol_preflight_incomplete
  ClearErrors
  ReadRegStr $2 HKCU "Software\Classes\kirinuki-engine" "URL Protocol"
  IfErrors kirinuki_protocol_preflight_incomplete
  StrCmp $2 "" kirinuki_protocol_preflight_complete kirinuki_protocol_preflight_incomplete

kirinuki_protocol_preflight_no_command:
  ClearErrors
  EnumRegValue $0 HKCU "Software\Classes\kirinuki-engine" 0
  IfErrors kirinuki_protocol_preflight_check_subkeys

kirinuki_protocol_preflight_incomplete:
  Abort "An incomplete kirinuki-engine protocol registration already exists."

kirinuki_protocol_preflight_check_subkeys:
  ClearErrors
  EnumRegKey $0 HKCU "Software\Classes\kirinuki-engine" 0
  IfErrors kirinuki_protocol_preflight_complete
  Abort "An incomplete kirinuki-engine protocol registration already exists."

kirinuki_protocol_preflight_complete:
!macroend

!macro customInstall
  # Register the browser-to-engine handoff as part of installation itself.
  # A silent install intentionally does not launch the app, so runtime-only
  # registration would leave the first browser button with no OS handler.
  ClearErrors
  WriteRegStr HKCU "Software\Classes\kirinuki-engine" "" "URL:kirinuki-engine"
  WriteRegStr HKCU "Software\Classes\kirinuki-engine" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\kirinuki-engine\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  IfErrors kirinuki_protocol_install_failed
  ReadRegStr $0 HKCU "Software\Classes\kirinuki-engine\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 kirinuki_protocol_install_failed
  ClearErrors
  ReadRegStr $1 HKCU "Software\Classes\kirinuki-engine" ""
  IfErrors kirinuki_protocol_install_failed
  StrCmp $1 "URL:kirinuki-engine" 0 kirinuki_protocol_install_failed
  ClearErrors
  ReadRegStr $2 HKCU "Software\Classes\kirinuki-engine" "URL Protocol"
  IfErrors kirinuki_protocol_install_failed
  StrCmp $2 "" kirinuki_protocol_install_complete kirinuki_protocol_install_failed

kirinuki_protocol_install_failed:
  Abort "Kirinuki Local Engine protocol registration failed."

kirinuki_protocol_install_complete:
!macroend

!macro customUnInstall
  # The uninstaller-only customCheckAppRunning macro has already completed the
  # exact executable handoff before electron-builder can remove application
  # files. Keep this section
  # idempotent and limited to product-owned registry/protocol fallback cleanup.
  # Electron's Windows login item is a per-user Run value with this exact
  # product-owned name. Remove both the command and Windows' approval record;
  # never enumerate or alter any other startup entry.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Kirinuki Local Engine"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Kirinuki Local Engine"

  # Runtime cleanup is authoritative. This exact-command fallback also covers
  # a never-launched or manually damaged installation without touching a
  # handler now owned by another program.
  ClearErrors
  ReadRegStr $0 HKCU "Software\Classes\kirinuki-engine\shell\open\command" ""
  IfErrors kirinuki_protocol_uninstall_complete
  StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 kirinuki_protocol_uninstall_complete
  ClearErrors
  ReadRegStr $1 HKCU "Software\Classes\kirinuki-engine" ""
  IfErrors kirinuki_protocol_uninstall_remove_command
  StrCmp $1 "URL:kirinuki-engine" 0 kirinuki_protocol_uninstall_remove_command
  ClearErrors
  ReadRegStr $2 HKCU "Software\Classes\kirinuki-engine" "URL Protocol"
  IfErrors kirinuki_protocol_uninstall_remove_command
  StrCmp $2 "" kirinuki_protocol_uninstall_remove_owned_values kirinuki_protocol_uninstall_remove_command

kirinuki_protocol_uninstall_remove_owned_values:
  DeleteRegValue HKCU "Software\Classes\kirinuki-engine" "URL Protocol"
  DeleteRegValue HKCU "Software\Classes\kirinuki-engine" ""

kirinuki_protocol_uninstall_remove_command:
  DeleteRegValue HKCU "Software\Classes\kirinuki-engine\shell\open\command" ""
  DeleteRegKey /ifempty HKCU "Software\Classes\kirinuki-engine\shell\open\command"
  DeleteRegKey /ifempty HKCU "Software\Classes\kirinuki-engine\shell\open"
  DeleteRegKey /ifempty HKCU "Software\Classes\kirinuki-engine\shell"
  DeleteRegKey /ifempty HKCU "Software\Classes\kirinuki-engine"
  ClearErrors
  ReadRegStr $0 HKCU "Software\Classes\kirinuki-engine\shell\open\command" ""
  IfErrors kirinuki_protocol_uninstall_verify_root_default
  StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' kirinuki_protocol_uninstall_failed kirinuki_protocol_uninstall_complete

kirinuki_protocol_uninstall_verify_root_default:
  ClearErrors
  ReadRegStr $1 HKCU "Software\Classes\kirinuki-engine" ""
  IfErrors kirinuki_protocol_uninstall_verify_url_marker
  StrCmp $1 "URL:kirinuki-engine" kirinuki_protocol_uninstall_failed kirinuki_protocol_uninstall_complete

kirinuki_protocol_uninstall_verify_url_marker:
  ClearErrors
  ReadRegStr $2 HKCU "Software\Classes\kirinuki-engine" "URL Protocol"
  IfErrors kirinuki_protocol_uninstall_complete
  StrCmp $2 "" kirinuki_protocol_uninstall_failed kirinuki_protocol_uninstall_complete

kirinuki_protocol_uninstall_failed:
  Abort "Kirinuki Local Engine protocol removal failed."

kirinuki_protocol_uninstall_complete:

  # Do not recursively remove LocalAppData here. A user-writable directory may
  # contain a junction/reparse point, so path-prefix ownership is not enough to
  # prove that traversal stays inside Kirinuki data. Keeping cache residue is
  # safer than deleting an arbitrary junction target. A future cleanup helper
  # must require an app-owned marker and reject every reparse point first.
!macroend
