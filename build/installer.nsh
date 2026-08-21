!macro customUnInstall
  # Ask this exact installed executable to stop its own gateway and retained
  # ffmpeg/yt-dlp process tree, then remove only its owned login/protocol state.
  # The secondary process waits for Electron's single-instance lock readback;
  # a non-zero result aborts before NSIS removes files under a live engine.
  IfFileExists "$INSTDIR\Kirinuki.exe" 0 kirinuki_cleanup_complete
  ExecWait '"$INSTDIR\Kirinuki.exe" --kirinuki-internal-owned-uninstall' $0
  StrCmp $0 "0" kirinuki_cleanup_complete
  Abort "Kirinuki Local Engine is still running. Close it and retry uninstall."

kirinuki_cleanup_complete:
  # Electron's Windows login item is a per-user Run value with this exact
  # product-owned name. Remove both the command and Windows' approval record;
  # never enumerate or alter any other startup entry.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Kirinuki Local Engine"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Kirinuki Local Engine"

  # Do not recursively remove LocalAppData here. A user-writable directory may
  # contain a junction/reparse point, so path-prefix ownership is not enough to
  # prove that traversal stays inside Kirinuki data. Keeping cache residue is
  # safer than deleting an arbitrary junction target. A future cleanup helper
  # must require an app-owned marker and reject every reparse point first.
!macroend
