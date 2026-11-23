; Included by electron-builder in the installer it packs (electron-builder.yml, `nsis.include`).
; The installer refuses to install a Scia older than the one installed (docs/adr/0018), and tells
; a Scia that runs that its session ends before it ends it (#13).
!ifndef BUILD_UNINSTALLER

!include LogicLib.nsh

; Windows' ERROR_PRODUCT_VERSION: "Another version of this product is already installed."
!define SCIA_REFUSED_EXIT_CODE 1638

Var SciaSeparator
Var SciaHead
Var SciaRest
Var SciaFound
Var SciaIndex
Var SciaChar
Var SciaNumber
Var SciaCount
Var SciaVersion
Var SciaCore
Var SciaPre
Var SciaHasPre
Var SciaBuild
Var SciaHasBuild
Var SciaSet
Var SciaAll
Var SciaReadable
Var SciaCoreA
Var SciaPreA
Var SciaHasPreA
Var SciaCoreB
Var SciaPreB
Var SciaHasPreB
Var SciaListA
Var SciaListB
Var SciaMoreA
Var SciaMoreB
Var SciaHeadA
Var SciaHeadB
Var SciaNumberA
Var SciaNumberB
Var SciaOrder
Var SciaInstalled
Var SciaThis
Var SciaRefusalText

; $SciaRest split at its first $SciaSeparator: $SciaHead before it, and $SciaFound 1 with
; $SciaRest after it when there was one, 0 with $SciaRest as it was when there was none.
Function SciaSplit
  StrCpy $SciaIndex 0
  ${Do}
    StrCpy $SciaChar $SciaRest 1 $SciaIndex
    ${If} $SciaChar == ""
      StrCpy $SciaHead $SciaRest
      StrCpy $SciaFound 0
      Return
    ${EndIf}
    ${If} $SciaChar == $SciaSeparator
      StrCpy $SciaHead $SciaRest $SciaIndex
      IntOp $SciaIndex $SciaIndex + 1
      StrCpy $SciaRest $SciaRest "" $SciaIndex
      StrCpy $SciaFound 1
      Return
    ${EndIf}
    IntOp $SciaIndex $SciaIndex + 1
  ${Loop}
FunctionEnd

; $SciaNumber 1 when $SciaHead is a number as semver writes one: digits, no leading zero. A
; prerelease can hold "-1", which is a word. IntOp reads 32 bits, so a larger number is not one
; here, and a version that holds it is unreadable.
Function SciaIsNumber
  StrCpy $SciaNumber 0
  StrCpy $SciaChar $SciaHead 1
  ${If} $SciaHead == ""
  ${OrIf} $SciaChar == "-"
    Return
  ${EndIf}
  IntOp $SciaIndex $SciaHead + 0
  ${If} $SciaIndex S== $SciaHead
    StrCpy $SciaNumber 1
  ${EndIf}
FunctionEnd

; $SciaAll 1 when $SciaHead is not empty and every character of it is in $SciaSet. The text goes
; to the System plug-in by the stack, never inside its call: a quote in a value would end it.
Function SciaAllIn
  StrCpy $SciaAll 0
  ${If} $SciaHead == ""
    Return
  ${EndIf}
  Push $SciaSet
  Push $SciaHead
  System::Call 'shlwapi::StrSpnW(w s, w s) i .s'
  Pop $SciaIndex
  StrLen $SciaChar $SciaHead
  ${If} $SciaIndex == $SciaChar
    StrCpy $SciaAll 1
  ${EndIf}
FunctionEnd

; $SciaAll 1 when $SciaHead is an identifier semver allows after "-" or "+": [0-9A-Za-z-]+.
Function SciaIsIdentifier
  StrCpy $SciaSet "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-"
  Call SciaAllIn
FunctionEnd

; $SciaVersion read as MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]: $SciaCore, $SciaPre, $SciaHasPre,
; and $SciaReadable 1 when it is one. A prerelease identifier of digits only is a number, which
; SciaIsNumber reads, or the version is unreadable.
Function SciaRead
  StrCpy $SciaReadable 0
  StrCpy $SciaSeparator "+"
  StrCpy $SciaRest $SciaVersion
  Call SciaSplit
  StrCpy $SciaBuild $SciaRest
  StrCpy $SciaHasBuild $SciaFound
  StrCpy $SciaSeparator "-"
  StrCpy $SciaRest $SciaHead
  Call SciaSplit
  StrCpy $SciaCore $SciaHead
  StrCpy $SciaPre $SciaRest
  StrCpy $SciaHasPre $SciaFound

  StrCpy $SciaSeparator "."
  StrCpy $SciaRest $SciaCore
  ${ForEach} $SciaCount 1 3 + 1
    Call SciaSplit
    Call SciaIsNumber
    ${If} $SciaNumber == 0
      Return
    ${EndIf}
    ${If} $SciaCount < 3
    ${AndIf} $SciaFound == 0
      Return
    ${EndIf}
  ${Next}
  ${If} $SciaFound == 1
    Return
  ${EndIf}

  ${If} $SciaHasPre == 1
    StrCpy $SciaRest $SciaPre
    ${Do}
      Call SciaSplit
      Call SciaIsIdentifier
      ${If} $SciaAll == 0
        Return
      ${EndIf}
      StrCpy $SciaSet "0123456789"
      Call SciaAllIn
      ${If} $SciaAll == 1
        Call SciaIsNumber
        ${If} $SciaNumber == 0
          Return
        ${EndIf}
      ${EndIf}
    ${LoopUntil} $SciaFound == 0
  ${EndIf}

  ${If} $SciaHasBuild == 1
    StrCpy $SciaRest $SciaBuild
    ${Do}
      Call SciaSplit
      Call SciaIsIdentifier
      ${If} $SciaAll == 0
        Return
      ${EndIf}
    ${LoopUntil} $SciaFound == 0
  ${EndIf}
  StrCpy $SciaReadable 1
FunctionEnd

; $SciaListA against $SciaListB, two lists of identifiers read by SciaRead, as semver orders them:
; numbers by value and below words, words in ASCII order, a list that ends first is lower.
; $SciaOrder -1, 0 or 1. They are split at ".", the separator SciaRead leaves.
Function SciaCompareLists
  StrCpy $SciaMoreA 1
  StrCpy $SciaMoreB 1
  ${Do}
    ${If} $SciaMoreA == 0
      ${If} $SciaMoreB == 0
        StrCpy $SciaOrder 0
      ${Else}
        StrCpy $SciaOrder -1
      ${EndIf}
      Return
    ${ElseIf} $SciaMoreB == 0
      StrCpy $SciaOrder 1
      Return
    ${EndIf}

    StrCpy $SciaRest $SciaListA
    Call SciaSplit
    StrCpy $SciaHeadA $SciaHead
    StrCpy $SciaListA $SciaRest
    StrCpy $SciaMoreA $SciaFound
    Call SciaIsNumber
    StrCpy $SciaNumberA $SciaNumber

    StrCpy $SciaRest $SciaListB
    Call SciaSplit
    StrCpy $SciaHeadB $SciaHead
    StrCpy $SciaListB $SciaRest
    StrCpy $SciaMoreB $SciaFound
    Call SciaIsNumber
    StrCpy $SciaNumberB $SciaNumber

    ${If} $SciaNumberA == 1
    ${AndIf} $SciaNumberB == 1
      IntCmp $SciaHeadA $SciaHeadB same lower higher
    ${ElseIf} $SciaNumberA == 1
      Goto lower
    ${ElseIf} $SciaNumberB == 1
      Goto higher
    ${EndIf}
    ; Two words. Ordinal: by code unit, which for the ASCII that semver allows is ASCII order.
    ; CSTR_LESS_THAN 1, CSTR_EQUAL 2, CSTR_GREATER_THAN 3.
    Push $SciaHeadB
    Push $SciaHeadA
    System::Call 'kernel32::CompareStringOrdinal(w s, i -1, w s, i -1, i 0) i .s'
    Pop $SciaIndex
    IntCmp $SciaIndex 2 same lower higher
    lower:
      StrCpy $SciaOrder -1
      Return
    higher:
      StrCpy $SciaOrder 1
      Return
    same:
  ${Loop}
FunctionEnd

; In: push A, then B. Out: the order of A against B, -1, 0 or 1, and "" when either is not a
; version SciaRead reads.
Function SciaVersionOrder
  Pop $SciaVersion
  Call SciaRead
  StrCpy $SciaCoreB $SciaCore
  StrCpy $SciaPreB $SciaPre
  StrCpy $SciaHasPreB $SciaHasPre
  ${If} $SciaReadable == 1
    Pop $SciaVersion
    Call SciaRead
  ${Else}
    Pop $SciaVersion
  ${EndIf}
  ${If} $SciaReadable == 0
    Push ""
    Return
  ${EndIf}
  StrCpy $SciaCoreA $SciaCore
  StrCpy $SciaPreA $SciaPre
  StrCpy $SciaHasPreA $SciaHasPre

  StrCpy $SciaListA $SciaCoreA
  StrCpy $SciaListB $SciaCoreB
  Call SciaCompareLists
  ${If} $SciaOrder == 0
    ; A version with a prerelease is older than the same version without one.
    ${If} $SciaHasPreA == 1
      ${If} $SciaHasPreB == 1
        StrCpy $SciaListA $SciaPreA
        StrCpy $SciaListB $SciaPreB
        Call SciaCompareLists
      ${Else}
        StrCpy $SciaOrder -1
      ${EndIf}
    ${ElseIf} $SciaHasPreB == 1
      StrCpy $SciaOrder 1
    ${EndIf}
  ${EndIf}
  Push $SciaOrder
FunctionEnd

; In: push the version installed, then this installer's. Out: the words of the refusal when the
; one installed is newer, "" when this one may install.
Function SciaRefusal
  Pop $SciaThis
  Pop $SciaInstalled
  Push $SciaInstalled
  Push $SciaThis
  Call SciaVersionOrder
  Pop $SciaOrder
  ${If} $SciaOrder == 1
    Push "${PRODUCT_NAME} $SciaInstalled is already installed, and it is newer than this installer's $SciaThis. To install $SciaThis, uninstall ${PRODUCT_NAME} first: your downloads and settings are kept."
  ${Else}
    Push ""
  ${EndIf}
FunctionEnd

; Run by the installer's .onInit once it knows where Scia is installed, and before it writes,
; closes or uninstalls anything. Every installer writes its version as DisplayVersion.
!macro customInit
  ReadRegStr $SciaInstalled SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ; A first install has no value, and the read sets the error flag electron-builder's script reads.
  ClearErrors
  Push $SciaInstalled
  Push "${VERSION}"
  Call SciaRefusal
  Pop $SciaRefusalText
  ${If} $SciaRefusalText != ""
    MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "$SciaRefusalText" /SD IDOK
    SetErrorLevel ${SCIA_REFUSED_EXIT_CODE}
    Quit
  ${EndIf}
!macroend

; Windows' WM_ENDSESSION with ENDSESSION_CLOSEAPP: the session ends for this program alone, as an
; installer needs its files. The Restart Manager says the same; Electron hands it to Scia as the
; window's "session-end", with the reason "close-app".
!define SCIA_WM_ENDSESSION 0x0016
!define SCIA_ENDSESSION_CLOSEAPP 0x0001
; SendMessageTimeout's SMTO_ABORTIFHUNG, and how long a window has to take the message.
!define SCIA_ABORT_IF_HUNG 0x0002
!define SCIA_MESSAGE_LIMIT_MS 5000
; PROCESS_QUERY_LIMITED_INFORMATION: enough to read which program a process runs.
!define SCIA_QUERY_LIMITED 0x1000
; How long the program has to end once told: Scia's engine has five seconds to stop and write its
; state, and is stopped after them (apps/desktop/src/server-process.ts).
!define SCIA_CLOSE_LIMIT_MS 15000
!define SCIA_CLOSE_STEP_MS 250
; Chromium's class for a top-level window: a BrowserWindow's, among others.
!define SCIA_WINDOW_CLASS "Chrome_WidgetWin_1"

Var SciaTarget
Var SciaTell
Var SciaTold
Var SciaLeft
Var SciaWaited
Var SciaWindow
Var SciaPid
Var SciaProcess
Var SciaImage

; $SciaLeft: how many top-level windows of Chromium's class, hidden ones included, belong to a
; process that runs the program $SciaTarget. With $SciaTell 1, each is told its session ends.
Function SciaWindowsOf
  StrCpy $SciaLeft 0
  StrCpy $SciaWindow ""
  ${Do}
    FindWindow $SciaWindow "${SCIA_WINDOW_CLASS}" "" "" $SciaWindow
    ${If} $SciaWindow == 0
      ${Break}
    ${EndIf}
    System::Call 'user32::GetWindowThreadProcessId(p $SciaWindow, *i .s)'
    Pop $SciaPid
    System::Call 'kernel32::OpenProcess(i ${SCIA_QUERY_LIMITED}, i 0, i $SciaPid) p .s'
    Pop $SciaProcess
    ${If} $SciaProcess != 0
      System::Call 'kernel32::QueryFullProcessImageNameW(p $SciaProcess, i 0, w .s, *i ${NSIS_MAX_STRLEN})'
      Pop $SciaImage
      System::Call 'kernel32::CloseHandle(p $SciaProcess)'
      ; LogicLib's == ignores case, as Windows' paths do.
      ${If} $SciaImage == $SciaTarget
        IntOp $SciaLeft $SciaLeft + 1
        ${If} $SciaTell == 1
          System::Call 'user32::SendMessageTimeoutW(p $SciaWindow, i ${SCIA_WM_ENDSESSION}, p 1, p ${SCIA_ENDSESSION_CLOSEAPP}, i ${SCIA_ABORT_IF_HUNG}, i ${SCIA_MESSAGE_LIMIT_MS}, p 0)'
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${Loop}
FunctionEnd

; Tells every window of a program running $SciaTarget that its session ends, then waits for them
; to be gone, SCIA_CLOSE_LIMIT_MS at most: a Scia told so writes its state, stops its engine and
; ends, and its downloads go on at its next start (#13). $SciaTold: how many windows were told.
Function SciaEndSessionOf
  StrCpy $SciaTell 1
  Call SciaWindowsOf
  StrCpy $SciaTold $SciaLeft
  StrCpy $SciaTell 0
  StrCpy $SciaWaited 0
  ${Do}
    ${If} $SciaLeft == 0
    ${OrIf} $SciaWaited >= ${SCIA_CLOSE_LIMIT_MS}
      ${Break}
    ${EndIf}
    Sleep ${SCIA_CLOSE_STEP_MS}
    IntOp $SciaWaited $SciaWaited + ${SCIA_CLOSE_STEP_MS}
    Call SciaWindowsOf
  ${Loop}
FunctionEnd

; electron-builder's own check of a running app ends it by force, with whatever it was writing. It
; is run here after Scia was told its session ends — for what is left, which it ends as before. Not
; for the update Scia installs at its own quit: that Scia has ended already. Defined only where
; electron-builder packs the installer: a program made of this include alone has none of its macros.
!ifdef PRODUCT_FILENAME
  ; What electron-builder's check needs and leaves out once a check of the app's own is defined.
  !include "getProcessInfo.nsh"
  Var pid

  !macro customCheckAppRunning
    ${IfNot} ${isUpdated}
      StrCpy $SciaTarget "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      Call SciaEndSessionOf
    ${EndIf}
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  !macroend
!endif

!endif
