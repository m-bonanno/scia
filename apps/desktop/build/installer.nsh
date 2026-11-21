; Included by electron-builder in the installer it packs (electron-builder.yml, `nsis.include`).
; The installer refuses to install a Scia older than the one installed (docs/adr/0016).
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

; $SciaVersion read as MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]: $SciaCore, $SciaPre, $SciaHasPre,
; and $SciaReadable 1 when it is one.
Function SciaRead
  StrCpy $SciaReadable 0
  StrCpy $SciaSeparator "+"
  StrCpy $SciaRest $SciaVersion
  Call SciaSplit
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
      ${If} $SciaHead == ""
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
    System::Call 'kernel32::CompareStringOrdinal(w "$SciaHeadA", i -1, w "$SciaHeadB", i -1, i 0) i .s'
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

!endif
