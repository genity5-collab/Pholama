// Pholama RetroStudio encoder. Turns Luau text into the CoolFormat string the RetroStudio plugin imports.
// It is a line-oriented compiler: it NEVER runs the Luau, only reads it.
// Format: SUB/ESC separated block records -> raw DEFLATE (level 6) -> base-93 -> header.
// Verified byte-for-byte against the reference golden files in test/retroencoder.test.js.
import { Buffer } from 'node:buffer';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
const CATALOG = {"AddDebrisItem":{"i":"\u001bTime\u001b0\u001b28\u001bObject\u001b0\u001bscript.Parent","o":""},"Addition":{"i":"\u001bNumber2\u001b0\u001b1\u001bNumber1\u001b0\u001b1","o":"\u001bResult\u001bAdditionVariable"},"AddPluginButton":{"i":"\u001bID\u001b0\u001b\u001bToolbarName\u001b0\u001b\u001bIcon\u001b0\u001b\u001bToolTip\u001b0\u001b","o":""},"AddPluginToolbar":{"i":"\u001bName\u001b0\u001b","o":""},"AddToLeaderstat":{"i":"\u001bPlayer\u001b0\u001b\u001bStatName\u001b0\u001b\u001bAmount\u001b0\u001b0","o":""},"AddToStudioSelection":{"i":"\u001bInstances\u001b0\u001b","o":""},"AddUserToChatChannel":{"i":"\u001bUserId\u001b0\u001b0\u001bChannel\u001b0\u001b","o":"\u001bTextSource\u001b"},"ANDAny":{"i":"\u001bA\u001b1\u001beee\u001bString\u001bB\u001b1\u001beee\u001bString","o":"\u001bResult\u001bAndVariable"},"Angles":{"i":"\u001brz\u001b0\u001b0\u001brx\u001b0\u001b0\u001bry\u001b0\u001b0","o":"\u001bResult\u001bCFrameAngle"},"AnimationStopped":{"i":"\u001bAnimationTrack\u001b0\u001b","o":""},"AnyPropertyChanged":{"i":"\u001bObject\u001b0\u001b","o":"\u001bNewValue\u001b\u001bProperty\u001b"},"Assert":{"i":"\u001bValue\u001b1\u001b0\u001bBool\u001bErrorMessage\u001b0\u001bassert","o":""},"BanPlayer":{"i":"\u001bPlayer\u001b0\u001b","o":""},"BindableFire2":{"i":"\u001bTUPLEPARAM_Parameters_3\u001b1\u001bJason\u001bString\u001bTUPLEPARAM_Parameters_1\u001b1\u001bsamething\u001bString\u001bParameters\u001b0\u001bTUPLEPARAM_Parameters_1,TUPLEPARAM_Parameters_2,TUPLEPARAM_Parameters_3\u001bBindableEvent\u001b0\u001bgame.Lighting\u001bTUPLEPARAM_Parameters_2\u001b1\u001blol\u001bString","o":""},"BindableFunctionInvoke":{"i":"\u001bBindableFunction\u001b0\u001bgame.Lighting.Remote\u001bTUPLEPARAM_Parameters_1\u001b1\u001berm\u001bString\u001bParameters\u001b0\u001bTUPLEPARAM_Parameters_1","o":"\u001bTUPLEPARAM_Output_1\u001berrrm\u001bTUPLE_Output\u001b1"},"BindableFunctionOnInvoke":{"i":"\u001bBindableFunction\u001b0\u001bgame.Lighting.remote","o":"\u001bTUPLE_Parameters\u001b1\u001bTUPLEPARAM_Parameters_1\u001bparam"},"BindableRecieve2":{"i":"\u001bBindableEvent\u001b0\u001bgame.Lighting.Remote","o":"\u001bTUPLE_Parameters\u001b1\u001bTUPLEPARAM_Parameters_1\u001bErm"},"BindToClose":{"i":"","o":""},"BlockThatMakesYourCharacterSentient":{"i":"\u001bHumanoid\u001b0\u001bthisisinvalidinthisformat","o":"\u001bResult\u001bResult"},"BreakJoints":{"i":"\u001bPart\u001b0\u001bscript.Parent","o":""},"BreakLoop":{"i":"","o":""},"BrickColorToColor3":{"i":"\u001bBrickColor\u001b0\u001bC2","o":"\u001bColor3\u001b"},"ChangeHumanoidState":{"i":"\u001bState\u001b0\u001bJump\u001bHumanoid\u001b0\u001bCharacter.Humanoid","o":""},"ChangeHumanoidStateLocal":{"i":"\u001bState\u001b0\u001bKeyed\u001bHumanoid\u001b0\u001bValued","o":"\u001bSuccess\u001bSuccess"},"CharacterAdded":{"i":"\u001bPlayer\u001b0\u001bPlayer","o":"\u001bCharacter\u001bChar"},"Chatted":{"i":"\u001bPlayer\u001b0\u001b","o":"\u001bMessage\u001b"},"ChattedSpecificMessage":{"i":"\u001bMessage\u001b0\u001b\u001bPlayer\u001b0\u001b","o":""},"CheckIfPlayerIsBanned":{"i":"\u001bUserId\u001b0\u001b0","o":"\u001bResult\u001b"},"CheckToolEquipped":{"i":"\u001bTool\u001b0\u001b","o":"\u001bResult\u001b"},"ChildAdded":{"i":"\u001bObject\u001b0\u001b","o":"\u001bChild\u001b\n\nlocal -- "},"ChildRemoved":{"i":"\u001bObject\u001b0\u001b","o":"\u001bChild\u001b"},"CloneObject":{"i":"\u001bParent\u001b0\u001bgame.Workspace\u001bObject\u001b0\u001bgame.Workspace.Baseplate","o":"\u001bNewObject\u001b"},"Color3ToBrickColor":{"i":"\u001bColor3\u001b0\u001bFF,FF,FF","o":"\u001bBrickColor\u001b"},"CombineNumberWithString":{"i":"\u001bNumber\u001b0\u001b64\u001bString\u001b0\u001bString\u001bAddSpace\u001b0\u001b0","o":"\u001bCombined\u001bCombined2"},"CombineStringWithNumber":{"i":"\u001bNumber\u001b0\u001b64\u001bString\u001b0\u001bString\u001bAddSpace\u001b0\u001b0","o":"\u001bCombined\u001bCombined"},"Comment2":{"i":"\u001bColor\u001b0\u001b3E9\u001bComment\u001b0\u001bThis Either Returns true or false","o":""},"Comparison":{"i":"\u001bComparisonType\u001b0\u001b==\u001bValue 2\u001b1\u001blol2\u001bString\u001bValue 1\u001b1\u001blol\u001bString","o":"\u001bResult\u001bcomparissed"},"ComputePath":{"i":"\u001bStartPosition\u001b0\u001b0,0,0\u001bEndPosition\u001b0\u001b0,0,0","o":"\u001bComputedPath\u001bPath"},"Concatenate":{"i":"\u001bFirstString\u001b0\u001bKiller\u001bSecondString\u001b0\u001bKyle","o":"\u001bResult\u001bCombinedStrings"},"ConstructCFrame":{"i":"\u001bRotation\u001b0\u001b0,0,0\u001bPosition\u001b0\u001b0,0,0","o":"\u001bCFrame\u001bCFrame"},"ConstructColor3":{"i":"\u001bB\u001b0\u001b0\u001bG\u001b0\u001b0\u001bR\u001b0\u001b0","o":"\u001bColor3\u001bColorrr"},"ConstructNumberRange":{"i":"\u001bMin\u001b0\u001b0\u001bMax\u001b0\u001b0","o":"\u001bNumberRange\u001b"},"ConstructUDim2":{"i":"\u001bYScale\u001b0\u001b0\u001bXScale\u001b0\u001b0\u001bXOffset\u001b0\u001b0\u001bYOffset\u001b0\u001b0","o":"\u001bUDim2\u001bUdim"},"ConstructVector2":{"i":"\u001bY\u001b0\u001b0\u001bX\u001b0\u001b0","o":"\u001bVector2\u001b"},"ConstructVector3":{"i":"\u001bY\u001b0\u001b0\u001bX\u001b0\u001b0\u001bZ\u001b0\u001b0","o":"\u001bVector3\u001bVector3Variable"},"ContinueLoop":{"i":"","o":""},"CreateChatChannel":{"i":"","o":"\u001bChannel\u001b"},"CreateLeaderstat":{"i":"\u001bStatName\u001b0\u001b\u001bInitialValue\u001b0\u001b0","o":""},"CreateObject":{"i":"\u001bParent\u001b0\u001bgame.Lighting\u001bClassName\u001b0\u001bBodyVelocity","o":"\u001bObject\u001bVariable_5941"},"CreateTable":{"i":"","o":"\u001bTableVariable\u001bTable_6229"},"DefineFunction":{"i":"","o":"\u001bFunction\u001bVariable_5439\u001bTUPLEPARAM_Parameters_1\u001btbl\u001bTUPLEPARAM_Parameters_3\u001binit\u001bTUPLE_Parameters\u001b3\u001bTUPLEPARAM_Parameters_2\u001bval"},"DescendantAdded":{"i":"\u001bObject\u001b0\u001b","o":"\u001bDescendant\u001b"},"DescendantRemoved":{"i":"\u001bObject\u001b0\u001b","o":"\u001bDescendant\u001b"},"DescendantRemoving":{"i":"\u001bObject\u001b0\u001bKeyed","o":"\u001bSuccess\u001b\u001bLoadedData\u001bData"},"DestroyObject":{"i":"\u001bObject\u001b0\u001bgame.Workspace.Baseplate","o":""},"DialogChat":{"i":"\u001bMessage\u001b0\u001b\u001bColor\u001b0\u001bBlue\u001bPart\u001b0\u001b","o":""},"DisconnectEvent":{"i":"\u001bEventConnection\u001b0\u001bConnection","o":""},"DistanceBetweenPoints":{"i":"\u001bPoint 2\u001b0\u001b0,0,0\u001bPoint 1\u001b0\u001b0,0,0","o":"\u001bDistance\u001bDistanceVariable"},"Division":{"i":"\u001bNumber2\u001b0\u001b1\u001bNumber1\u001b0\u001b1","o":"\u001bResult\u001bDivisionVariable"},"DoNotRun":{"i":"","o":""},"DumpMemory":{"i":"","o":""},"Error":{"i":"\u001bText\u001b0\u001berrored","o":""},"ExecuteBlock":{"i":"\u001bName\u001b0\u001b","o":""},"ExecuteFunction":{"i":"\u001bFunction\u001b0\u001bVariable_3703\u001bParameters\u001b0\u001bTUPLEPARAM_Parameters_1,TUPLEPARAM_Parameters_2\u001bTUPLEPARAM_Parameters_2\u001b2\u001bVariable_3700\u001bTUPLEPARAM_Parameters_1\u001b1\u001b[RetroStudio ClickDetector]: Part clicked by player: %s\u001bString","o":"\u001bTUPLE_ReturnedValues\u001b1\u001bTUPLEPARAM_ReturnedValues_1\u001bVariable_3702"},"Exponentiation":{"i":"\u001bNumber2\u001b0\u001b2\u001bNumber1\u001b0\u001b1","o":"\u001bResult\u001bExponentiationVariable"},"FilterString":{"i":"\u001bString\u001b0\u001b","o":"\u001bResult\u001b"},"FindFirstChild":{"i":"\u001bParent\u001b0\u001bgame\u001bChildName\u001b0\u001bDebris\u001bRecursive\u001b0\u001b0","o":"\u001bResult\u001bVariable_5059"},"FindFirstChildNew":{"i":"\u001bCanReturnNil\u001b0\u001b1\u001bChildName\u001b0\u001bBaseplate\u001bRecursive\u001b0\u001b0\u001bParent\u001b0\u001bgame.Workspace","o":"\u001bResult\u001bFoundPart"},"FindFirstChildOfClass":{"i":"\u001bParent\u001b2\u001bplayer\u001bChildClass\u001b0\u001bPlayerGui","o":"\u001bResult\u001bVariable_4237"},"FindFirstChildWhichIsANew":{"i":"\u001bChildClass\u001b0\u001b\u001bCanReturnNil\u001b0\u001b0\u001bParent\u001b0\u001b","o":"\u001bResult\u001b"},"FindPartOnRay":{"i":"\u001bFilterDescendantsTable\u001b0\u001b\u001bDirection\u001b0\u001b0,0,0\u001bOrigin\u001b0\u001b0,0,0\u001bFilterType\u001b0\u001bBlacklist","o":"\u001bNormal\u001b\u001bInstance\u001b\u001bPosition\u001b"},"FindString":{"i":"\u001bPattern\u001b0\u001b\u001bString\u001b0\u001b","o":"\u001bResult\u001b"},"ForLoop2":{"i":"\u001bInitial\u001b0\u001b1\u001bIncrement\u001b0\u001b1\u001bMaximum\u001b0\u001bA","o":"\u001bPlace\u001b"},"FromAxisAngle":{"i":"\u001bv\u001b0\u001b0,0,0\u001br\u001b0\u001b","o":"\u001bCFrame\u001bAxisAngle"},"FromMatrix":{"i":"\u001bvZ\u001b0\u001b0,0,0\u001bpos\u001b0\u001b0,0,0\u001bvX\u001b0\u001b0,0,0\u001bvY\u001b0\u001b0,0,0","o":"\u001bCFrame\u001bMatrixCFrameVariable"},"FunctionReturn":{"i":"\u001bTUPLEPARAM_Parameters_1\u001b2\u001bVariable_6556\u001bReturns\u001b0\u001bTUPLEPARAM_Parameters_1","o":""},"GetCameraPositionLocal":{"i":"","o":"\u001bRotation\u001b\u001bPosition\u001b"},"GetCFrameDirection":{"i":"\u001bCFrame\u001b0\u001b\u001bDirection\u001b0\u001bForward","o":"\u001bDirection\u001bDir"},"GetChildren":{"i":"\u001bParent\u001b0\u001bgame.Workspace","o":"\u001bChildrenTable\u001b"},"GetConnectedParts":{"i":"\u001bPart\u001b0\u001b","o":"\u001bPartsTable\u001b"},"GetDefaultChannel":{"i":"","o":"\u001bChannel\u001b"},"GetDescendants":{"i":"\u001bParent\u001b0\u001bgame.Workspace","o":"\u001bDescendantTable\u001b"},"GetFullName":{"i":"\u001bObject\u001b0\u001bscript.Parent","o":"\u001bFullName\u001bFN"},"GetGameBadges":{"i":"","o":"\u001bBadges\u001b"},"GetGameInfo":{"i":"","o":"\u001bGameInfo\u001b"},"GetGamepasses":{"i":"","o":"\u001bGamepasses\u001b"},"GetHumanoidState":{"i":"\u001bHumanoid\u001b0\u001bCharacter.Humanoid","o":"\u001bState\u001bState"},"GetJoints":{"i":"\u001bPart\u001b0\u001b","o":"\u001bJoints\u001b"},"GetLeaderstat":{"i":"\u001bPlayer\u001b0\u001bgame.Players.LocalPlayer\u001bStatName\u001b0\u001bCoins","o":"\u001bValue\u001bV"},"GetLength":{"i":"\u001bString\u001b0\u001bKillerKyle","o":"\u001bLength\u001bLength"},"GetModelThumbnail":{"i":"\u001bModel\u001b0\u001b\u001bGui\u001b0\u001b","o":""},"GetMousePosition2D":{"i":"\u001bPlayer\u001b0\u001b","o":"\u001bY\u001b\u001bX\u001b"},"GetMousePosition3D":{"i":"\u001bPlayer\u001b0\u001b","o":"\u001bPosition\u001b"},"GetMouseTargetPart":{"i":"\u001bPlayer\u001b0\u001b","o":"\u001bTargetPart\u001b"},"GetMouseTargetPartLocal":{"i":"","o":"\u001bTargetPart\u001bMouseTarget"},"GetMouseTargetSurface":{"i":"\u001bPlayer\u001b0\u001b","o":"\u001bSurface\u001b"},"GetNameFromUserIdAsync":{"i":"\u001bUserId\u001b0\u001b0","o":"\u001bUsername\u001b"},"GetPartDirection":{"i":"\u001bPart\u001b0\u001bscript.Parent\u001bDirection\u001b0\u001bForward","o":"\u001bDirection\u001bPartDirection"},"GetPlayerFromCharacter":{"i":"\u001bCharacter\u001b0\u001bCharacter","o":"\u001bPlayer\u001bPlr"},"GetPlayersOnTeam":{"i":"\u001bTeam\u001b0\u001b","o":"\u001bPlayerTable\u001b"},"GetRandomChild":{"i":"\u001bParent\u001b0\u001bgame.Workspace","o":"\u001bResult\u001bRandomChild"},"GetRankInGroup":{"i":"\u001bPlayer\u001b0\u001bplayer\u001bGroupId\u001b0\u001b1E240","o":"\u001bResult\u001bRankGroup"},"GetRobloxVersion":{"i":"","o":"\u001bAnswer\u001bGetRobloxVersion"},"GetServerTimeNow":{"i":"","o":"\u001bAnswer\u001bServerTime"},"GetStudioSelection":{"i":"","o":"\u001bSelection\u001b"},"GetStudioTheme":{"i":"","o":"\u001bDesign\u001b\u001bColor\u001b"},"GetTableValue":{"i":"\u001bKey\u001b1\u001bName\u001bString\u001bTable\u001b0\u001bplayerWhoClicked","o":"\u001bValue\u001bVariable_3700"},"GetTestStatus":{"i":"","o":"\u001bStatus\u001b"},"GetTouchingParts":{"i":"\u001bPart\u001b0\u001b","o":"\u001bPartsTable\u001b"},"GetUserIdFromNameAsync":{"i":"\u001bUsername\u001b0\u001b","o":"\u001bUserId\u001b"},"GetUserThumbnail":{"i":"\u001bUserId\u001b0\u001b0","o":"\u001bImageId\u001b"},"GiveBadge":{"i":"\u001bBadgeId\u001b0\u001b0\u001bPlayer\u001b0\u001b","o":"\u001bResult\u001b"},"GSubString":{"i":"\u001bString\u001b0\u001bkillerkyle\u001bReplacement\u001b0\u001b\u001bPattern\u001b0\u001bkiller","o":"\u001bResult\u001bGSUBEDString"},"GUILeftMouseButtonClick":{"i":"\u001bGUIButton\u001b2\u001btextButton","o":"\u001bEventConnection\u001bVariable_4376"},"GUILeftMouseButtonUp":{"i":"\u001bGUIButton\u001b0\u001b","o":""},"GUIMouseEnter":{"i":"\u001bGUI\u001b0\u001b","o":""},"GUIMouseLeave":{"i":"\u001bGUI\u001b0\u001b","o":""},"GUIRightMouseButtonClick":{"i":"\u001bGUIButton\u001b0\u001b","o":""},"GUIRightMouseButtonDown":{"i":"\u001bGUIButton\u001b0\u001b","o":""},"HandlesMouseButtonDown":{"i":"\u001bHandles\u001b0\u001b","o":"\u001bHandle\u001b"},"HandlesMouseButtonUp":{"i":"\u001bHandles\u001b0\u001b","o":"\u001bHandle\u001b"},"HasBadge":{"i":"\u001bBadgeId\u001b0\u001b0\u001bPlayer\u001b0\u001b","o":"\u001bResult\u001b"},"HasBadgeFromForeignPlace":{"i":"\u001bBadgeId\u001b0\u001b0\u001bPlayer\u001b0\u001b\u001bPlaceId\u001b0\u001b","o":"\u001bResult\u001b"},"HasGamepass":{"i":"\u001bGamepassId\u001b0\u001b0\u001bPlayer\u001b0\u001b","o":"\u001bResult\u001b"},"HasGamepassFromForeignPlace":{"i":"\u001bPlaceId\u001b0\u001b\u001bGamepassId\u001b0\u001b0\u001bPlayer\u001b0\u001b","o":"\u001bResult\u001b"},"Heartbeat":{"i":"","o":"\u001bDeltaTime\u001b"},"HideLeaderboard":{"i":"\u001bHide\u001b0\u001b0","o":"\u001bResult\u001bResult"},"HumanoidDied":{"i":"\u001bHumanoid\u001b0\u001bCharacter.Humanoid","o":""},"HumanoidFreeFalling":{"i":"\u001bHumanoid\u001b0\u001bCharacter.Humanoid","o":"\u001bActive\u001b"},"HumanoidJumping":{"i":"\u001bHumanoid\u001b0\u001b","o":"\u001bActive\u001b"},"HumanoidMoveTo":{"i":"\u001bTarget\u001b0\u001b0,0,0\u001bHumanoid\u001b0\u001bCharacter.Humanoid","o":""},"HumanoidMoveToFinished":{"i":"\u001bHumanoid\u001b0\u001bCharacter.Humanoid","o":"\u001bReachedTarget\u001bTarget"},"HumanoidRunning":{"i":"\u001bHumanoid\u001b0\u001b","o":"\u001bSpeed\u001b"},"HumanoidSeated":{"i":"\u001bHumanoid\u001b0\u001bCharacter.Humanoid","o":"\u001bSeat\u001bSeat\u001bActive\u001bAct"},"HumanoidStateChanged":{"i":"\u001bHumanoid\u001b0\u001bCharacter.Humanoid","o":"\u001bPreviousState\u001bPrev\u001bNewState\u001bNew"},"If":{"i":"\u001bValue 1\u001b1\u001be\u001bString\u001bValue 2\u001b1\u001be\u001bString\u001bComparisonType\u001b0\u001b==","o":""},"InputBegan":{"i":"","o":"\u001bProcessed\u001bProcesseds\u001bType\u001bTypes\u001bPosition\u001b\u001bKeyCode\u001bKeycodes"},"InputChanged":{"i":"","o":"\u001bType\u001b\u001bKeyCode\u001b\u001bPosition\u001b\u001bDelta\u001b\u001bProcessed\u001b"},"InputEnded":{"i":"","o":"\u001bProcessed\u001b\u001bType\u001b\u001bPosition\u001b\u001bKeyCode\u001b"},"InsertModel":{"i":"\u001bID\u001b0\u001b0\u001bParent\u001b0\u001b","o":"\u001bSuccess\u001b\u001bLoadedModel\u001b"},"InsertRetrostudioAvatar":{"i":"\u001bID\u001b0\u001b0\u001bCFrame\u001b0\u001b","o":"\u001bModel\u001b"},"InverseCFrame1":{"i":"\u001bCFrame\u001b2\u001bCFramee","o":"\u001bResult\u001bInversedCFrameVariable"},"IsA":{"i":"\u001bObject\u001b0\u001bgame.Workspace.Baseplate\u001bClass\u001b0\u001bPart","o":"\u001bResult\u001bResult"},"IsAncestorOf":{"i":"\u001bDescendant\u001b0\u001b\u001bAncestor\u001b0\u001b","o":"\u001bOutputValue\u001b"},"IsClient":{"i":"","o":"\u001bAnswer\u001bIsClient"},"IsDescendantOf":{"i":"\u001bDescendant\u001b0\u001bscript.Parent\u001bAncestor\u001b0\u001bscript.Parent.Parent","o":"\u001bOutputValue\u001bCheck"},"IsFriendsWith":{"i":"\u001bUserId\u001b0\u001b0\u001bPlayer\u001b0\u001b","o":"\u001bResult\u001b"},"IsGameLoaded":{"i":"","o":"\u001bAnswer\u001bIsLoaded"},"IsGuest":{"i":"\u001bPlayer\u001b0\u001bgame.Players.LocalPlayer","o":"\u001bAnswer\u001bIsGuestPlayer"},"IsInGroup":{"i":"\u001bPlayer\u001b0\u001bplayer\u001bGroupId\u001b0\u001b1E240","o":"\u001bResult\u001bcompareGroup"},"IsOwner":{"i":"\u001bAllowAuthorizedUsers\u001b0\u001b1\u001bPlayer\u001b0\u001bgame.Players.LocalPlayer","o":"\u001bResult\u001bIsOwnerTrue"},"IsPlayingSolo":{"i":"","o":"\u001bAnswer\u001bIsSolo"},"IsServer":{"i":"","o":"\u001bAnswer\u001b"},"IsStudio":{"i":"","o":"\u001bAnswer\u001bIsStudio"},"IsTouching":{"i":"\u001bPart1\u001b0\u001b\u001bPart2\u001b0\u001b","o":"\u001bIsTouching\u001b"},"IsTouchscreen":{"i":"","o":"\u001bAnswer\u001b"},"JsonDecode":{"i":"\u001bJSON\u001b2\u001bJSON","o":"\u001bTable\u001btable"},"JsonEncode":{"i":"\u001bTable\u001b0\u001btable","o":"\u001bJSON\u001bJSON"},"KeyDown":{"i":"\u001bKey\u001b0\u001b\u001bPlayer\u001b0\u001b","o":""},"KeyDownLocal":{"i":"\u001bKey\u001b0\u001b","o":""},"KeyUp":{"i":"\u001bKey\u001b0\u001b\u001bPlayer\u001b0\u001b","o":""},"KickPlayer":{"i":"\u001bPlayer\u001b0\u001b\u001bReason\u001b0\u001b","o":""},"LeaderstatChanged":{"i":"\u001bPlayer\u001b0\u001b\u001bStatName\u001b0\u001b","o":"\u001bValue\u001b"},"LeftMouseDown":{"i":"\u001bPlayer\u001b0\u001b","o":""},"LeftMouseUp":{"i":"\u001bPlayer\u001b0\u001b","o":""},"Lerp1":{"i":"\u001bGoalCFrame\u001b2\u001bGoalCFramee\u001bAlpha\u001b0\u001b0\u001bStartCFrame\u001b2\u001bStartCFramee","o":"\u001bResult\u001bLerpVariableCFrame"},"LoadAnimation":{"i":"\u001bHumanoid\u001b0\u001b\u001bAnimation\u001b0\u001b","o":"\u001bAnimationTrack\u001b"},"LoadCharacter":{"i":"\u001bPlayer\u001b0\u001b","o":""},"LoadInstance":{"i":"\u001bParent\u001b0\u001b\u001bKey\u001b0\u001b\u001bShared\u001b0\u001b0","o":"\u001bSuccess\u001b\u001bLoadedModel\u001b"},"LoadVariable":{"i":"\u001bKey\u001b0\u001bwoahwoah\u001bShared\u001b0\u001b0","o":"\u001bSuccess\u001bSuccess\u001bLoadedData\u001bData"},"LoopThroughDescendants":{"i":"\u001bObject\u001b0\u001b","o":"\u001bDescendant\u001b"},"LoopThroughTable":{"i":"\u001bTable\u001b0\u001btbl","o":"\u001bIndex\u001bVariable_5425\u001bValue\u001bVariable_5426"},"Lower":{"i":"\u001bString\u001b0\u001bAHAH","o":"\u001bResult\u001bLower"},"MakeJoints":{"i":"\u001bPart\u001b0\u001bscript.Parent","o":""},"MathLibraryDoubleInput":{"i":"\u001bFunction\u001b0\u001batan2\u001bNumber2\u001b0\u001b1\u001bNumber1\u001b0\u001b1","o":"\u001bResult\u001bmathVariable2"},"MathLibrarySingleInput":{"i":"\u001bNumber\u001b0\u001b1\u001bFunction\u001b0\u001babs","o":"\u001bResult\u001bmathVariable"},"MathLibraryTripleInput":{"i":"\u001bFunction\u001b0\u001bclamp\u001bNumber3\u001b0\u001b0\u001bNumber2\u001b0\u001b0\u001bNumber1\u001b0\u001b0","o":"\u001bResult\u001bmathVariable3"},"MathPi":{"i":"","o":"\u001bMessage\u001b\u001bMessageType\u001b"},"ModelInserted":{"i":"","o":"\u001bID\u001b\u001bLoadedModel\u001b\u001bSourceScript\u001b\u001bSuccess\u001b"},"Modulus":{"i":"\u001bNumber2\u001b0\u001b1\u001bNumber1\u001b0\u001b1","o":"\u001bResult\u001bModulusVariable"},"MoveModelTo":{"i":"\u001bModel\u001b0\u001b\u001bPosition\u001b0\u001b0,0,0","o":""},"Multiplication":{"i":"\u001bNumber2\u001b0\u001b1\u001bNumber1\u001b0\u001b1","o":"\u001bResult\u001bMultiplicationVariable"},"MutePlayer":{"i":"\u001bMute\u001b0\u001b1\u001bPlayer\u001b0\u001b","o":""},"NormalizeVector3":{"i":"\u001bVector3\u001b0\u001b0,0,0","o":"\u001bResult\u001bNormalizedVector3Variable"},"NOTAny":{"i":"\u001bA\u001b1\u001b1\u001bBool","o":"\u001bResult\u001breversedVariable"},"ORAny":{"i":"\u001bA\u001b1\u001be\u001bString\u001bB\u001b1\u001be\u001bString","o":"\u001bResult\u001bOrVariable"},"OsClock":{"i":"","o":"\u001bAnswer\u001bOsClockVariable"},"OsDate":{"i":"\u001bTime\u001b0\u001b0\u001bTimezone\u001b0\u001bUTC","o":"\u001bDateTable\u001bOsDataVariableTable"},"OsTime":{"i":"","o":"\u001bAnswer\u001bOsTimeVariable"},"PauseSound":{"i":"\u001bSound\u001b0\u001bscript.Parent.Sound","o":""},"PerlinNoise":{"i":"\u001bY\u001b0\u001b0\u001bX\u001b0\u001b0\u001bZ\u001b0\u001b0","o":"\u001bResult\u001bPerlinNoiseVariable"},"PlayAnimation":{"i":"\u001bSpeed\u001b0\u001b1\u001bAnimationTrack\u001b0\u001b\u001bFadeTime\u001b0\u001b0.64\u001bWeight\u001b0\u001b1","o":""},"PlayerAdded":{"i":"","o":"\u001bPlayer\u001bPlayer"},"PlayerRemoving":{"i":"","o":"\u001bPlayer\u001bPlayer"},"PlaySound":{"i":"\u001bSound\u001b0\u001bscript.Parent.Sound","o":""},"PluginButtonClicked":{"i":"\u001bID\u001b0\u001b\u001bToolbarName\u001b0\u001b","o":""},"PluginButtonSetActive":{"i":"\u001bID\u001b0\u001b\u001bToolbarName\u001b0\u001b\u001bState\u001b0\u001b0","o":""},"PluginDeactivating":{"i":"","o":""},"PowerlangImport":{"i":"\u001bVisualSource\u001b0\u001bthisisinvalidinthisformat\u001bNewParent\u001b0\u001bgame.Workspace\u001bFilterDelay\u001b0\u001b1\u001bServerOrLocal\u001b0\u001b1\u001bUseLocalVariables\u001b0\u001b1\u001bInfoRemote\u001b0\u001banyremote\u001bRetryAmount\u001b0\u001bA","o":"\u001bTUPLE_Info\u001b0"},"PowerlangImport2":{"i":"\u001bRetryAmount\u001b0\u001bA\u001bUseLocalVariables\u001b0\u001b1\u001bScriptClass\u001b0\u001bScript\u001bNewParent\u001b0\u001bgame.Worksapce\u001bFilterDelay\u001b0\u001b1\u001bInfoRemote\u001b0\u001banyremote\u001bVisualSource\u001b0\u001behem","o":"\u001bTUPLE_Info\u001b0"},"PreSimulation":{"i":"","o":"\u001bdeltaTime\u001b"},"Print":{"i":"\u001bText\u001b0\u001bprint","o":""},"PromptDeveloperProductPurchase":{"i":"\u001bPlayer\u001b0\u001b\u001bDeveloperProductId\u001b0\u001b0","o":""},"PromptDeveloperProductPurchaseFinished":{"i":"","o":"\u001bPlayer\u001b\u001bDeveloperProductId\u001b\u001bPurchased\u001b"},"PromptGamepassPurchase":{"i":"\u001bGamepassId\u001b0\u001b0\u001bPlayer\u001b0\u001b","o":""},"PromptGamepassPurchaseFinished":{"i":"","o":"\u001bPlayer\u001b\u001bGamepassId\u001b\u001bPurchased\u001b"},"PropertyChanged":{"i":"\u001bObject\u001b0\u001b\u001bProperty\u001b0\u001b","o":"\u001bNewValue\u001b"},"RandomBrickColor":{"i":"","o":"\u001bBrickColor\u001b"},"RandomNumber":{"i":"\u001bMinimum\u001b0\u001b1\u001bMaximum\u001b0\u001b1","o":"\u001bResult\u001bRandomNumberVariable"},"RBXGuiCreateDropDownMenu":{"i":"\u001bItems\u001b0\u001b\u001bOnSelect\u001b0\u001b","o":"\u001bDropDown\u001b\u001bUpdateSelection\u001b"},"ReceiveChatMessage":{"i":"\u001bChannel\u001b0\u001b","o":"\u001bTextChatMessage\u001b"},"ReloadPlace":{"i":"","o":""},"RemoteFireServer2":{"i":"\u001bRemoteEvent\u001b0\u001bgame.Lighting.Remote\u001bTUPLEPARAM_Parameters_3\u001b1\u001bkiki\u001bString\u001bTUPLEPARAM_Parameters_1\u001b1\u001bFaha\u001bString\u001bTUPLEPARAM_Parameters_5\u001b1\u001bjason\u001bString\u001bTUPLEPARAM_Parameters_4\u001b1\u001bmama\u001bString\u001bParameters\u001b0\u001bTUPLEPARAM_Parameters_1,TUPLEPARAM_Parameters_2,TUPLEPARAM_Parameters_3,TUPLEPARAM_Parameters_4,TUPLEPARAM_Parameters_5\u001bTUPLEPARAM_Parameters_2\u001b1\u001blol\u001bString","o":""},"RemoteFunctionInvokeServer":{"i":"\u001bTUPLEPARAM_Parameters_1\u001b1\u001be\u001bString\u001bRemoteFunction\u001b0\u001bgame.Lighting\u001bParameters\u001b0\u001bTUPLEPARAM_Parameters_1","o":"\u001bTUPLE_Output\u001b2\u001bTUPLEPARAM_Output_1\u001be\u001bTUPLEPARAM_Output_2\u001bee"},"RemoteFunctionOnInvokeClient":{"i":"\u001bRemoteFunction\u001b0\u001bgame.Lighting","o":"\u001bTUPLE_Parameters\u001b0"},"RenderStepped":{"i":"","o":"\u001bdeltaTime\u001b"},"Require":{"i":"\u001bModuleScript\u001b0\u001bscript.Parent.ModuleScript","o":"\u001bReturned\u001b"},"ResumeSound":{"i":"\u001bSound\u001b0\u001bscript.Parent.Sound","o":""},"RightMouseDown":{"i":"\u001bPlayer\u001b0\u001b","o":""},"RightMouseUp":{"i":"\u001bPlayer\u001b0\u001b","o":""},"RotationBetweenPoints":{"i":"\u001bPoint 1\u001b0\u001b0,0,0\u001bPoint 2\u001b0\u001b0,0,0","o":"\u001bRotationVector3\u001bRotationDirection"},"Round":{"i":"\u001bNumber\u001b0\u001b0\u001bType\u001b0\u001bRound","o":"\u001bResult\u001bRoundVariable"},"SaveInstance":{"i":"\u001bKey\u001b0\u001b\u001bShared\u001b0\u001b0\u001bModel\u001b0\u001b","o":"\u001bSuccess\u001b"},"SaveVariable":{"i":"\u001bValue\u001b1\u001b1\u001bBool\u001bKey\u001b0\u001bwoahwoah\u001bShared\u001b0\u001b0","o":"\u001bSuccess\u001bSuccess"},"SendChatMessage":{"i":"\u001bMessage\u001b0\u001b\u001bChannel\u001b0\u001b","o":"\u001bTextChatMessage\u001b"},"SetCameraPositionLocal":{"i":"\u001bRotation\u001b0\u001b0,0,0\u001bPosition\u001b0\u001b0,0,0","o":""},"SetCell":{"i":"\u001bOrientation\u001b0\u001bNegZ\u001bMaterial\u001b0\u001bEmpty\u001bBlock\u001b0\u001bSolid\u001bPosition\u001b0\u001b0,0,0","o":""},"SetCoreGuiEnabled":{"i":"\u001bEnabled\u001b0\u001b0\u001bCoreGui\u001b0\u001bAll","o":"\u001bResult\u001b"},"SetJoinAfterMoveInstance":{"i":"\u001bInstance\u001b0\u001b","o":"\u001bSuccess\u001b\u001bID\u001b"},"SetLeaderstat":{"i":"\u001bValue\u001b0\u001b0\u001bPlayer\u001b0\u001b\u001bStatName\u001b0\u001b","o":""},"SetModelPrimaryPartCFrameNew":{"i":"\u001bModel\u001b0\u001b\u001bCFrame\u001b0\u001b","o":""},"SetMouseIconLocal":{"i":"\u001bIcon\u001b0\u001brbxassetid://0","o":""},"SetNetworkOwner":{"i":"\u001bPart\u001b0\u001bscript.Parent\u001bPlayer\u001b1\u001bgame.Players.LocalPlayer\u001bObject","o":""},"SetObjectProperty":{"i":"\u001bValue\u001b1\u001bSimulate Mouse Click\u001bString\u001bProperty\u001b0\u001bText\u001bObject\u001b2\u001btextButton","o":""},"SetTableValue":{"i":"\u001bValue\u001b1\u001bsilly\u001bString\u001bKey\u001b1\u001bgoober\u001bString\u001bTable\u001b0\u001btable","o":""},"SetVariable1":{"i":"\u001bValue\u001b1\u001b0\u001bBool","o":"\u001bVariableName\u001bEhem"},"SolveEquation":{"i":"\u001bEquation\u001b0\u001b1+1","o":"\u001bResult\u001bSolveEquationVariable"},"SortTable":{"i":"\u001bOrder\u001b0\u001bLow to High\u001bTable\u001b0\u001btable","o":""},"SortTableAdvanced":{"i":"\u001bTable\u001b0\u001bTable","o":"\u001bValueA\u001bA\u001bValueB\u001bB"},"SortTableAdvancedReturn":{"i":"\u001bReturn\u001b0\u001b0","o":""},"Spawn":{"i":"\u001bFunction\u001b0\u001bVariable_6610\u001bParameters\u001b0\u001bTUPLEPARAM_Parameters_1\u001bTUPLEPARAM_Parameters_1\u001b2\u001bVariable_6604","o":""},"SplitCFrame":{"i":"\u001bCFrame\u001b0\u001b","o":"\u001bRotation\u001bRotation\u001bPosition\u001bPosition"},"SplitColor3":{"i":"\u001bColor3\u001b0\u001bFF,FF,FF","o":"\u001bR\u001b\u001bG\u001b\u001bB\u001b"},"SplitNumberRange":{"i":"\u001bNumberRange\u001b0\u001b","o":"\u001bMin\u001b\u001bMax\u001b"},"SplitString":{"i":"\u001bString\u001b0\u001bKillerKyle\u001bSeperator\u001b0\u001br","o":"\u001bResult\u001bSplitted"},"SplitUDim2":{"i":"\u001bUDim2\u001b0\u001b0,0,0,0","o":"\u001bXOffset\u001b\u001bXScale\u001b\u001bYScale\u001b\u001bYOffset\u001b"},"SplitVector2":{"i":"\u001bVector2\u001b0\u001b0,0","o":"\u001bY\u001b\u001bX\u001b"},"SplitVector3":{"i":"\u001bVector3\u001b0\u001b0,0,0","o":"\u001bY\u001bYVariable\u001bX\u001bXVariable\u001bZ\u001bZVariable"},"StopAnimation":{"i":"\u001bAnimationTrack\u001b0\u001b\u001bFadeTime\u001b0\u001b0.64","o":""},"StopSound":{"i":"\u001bSound\u001b0\u001bscript.Parent.Sound","o":""},"StudioSelectionChanged":{"i":"","o":"\u001bSelection\u001b"},"Substring":{"i":"\u001bStartPoint\u001b0\u001b0\u001bString\u001b0\u001b\u001bEndPoint\u001b0\u001b0","o":"\u001bResult\u001b"},"Subtraction":{"i":"\u001bNumber2\u001b0\u001b1\u001bNumber1\u001b0\u001b1","o":"\u001bResult\u001bSubstractionVariable"},"TableAppend":{"i":"\u001bValue\u001b1\u001blol\u001bString\u001bTable\u001b0\u001btable","o":""},"TableFind":{"i":"\u001bValue\u001b1\u001bhey\u001bString\u001bTable\u001b0\u001btable\u001bInit\u001b0\u001b1","o":"\u001bKey\u001bKeyVariable"},"TableInsert":{"i":"\u001bValue\u001b1\u001bhey\u001bString\u001bPosition\u001b0\u001b1\u001bTable\u001b0\u001btable","o":""},"TablePack":{"i":"\u001bValues\u001b0\u001bTUPLEPARAM_Values_1\u001bTUPLEPARAM_Values_1\u001b1\u001bhey\u001bString","o":"\u001bTableVariable\u001bPackTableVariable"},"TableRemove":{"i":"\u001bPosition\u001b0\u001b1\u001bTable\u001b0\u001btable","o":""},"TableUnpack":{"i":"\u001bTable\u001b0\u001btable","o":"\u001bTUPLE_Values\u001b1\u001bTUPLEPARAM_Values_1\u001bPackedInTable1"},"TakeDamage":{"i":"\u001bPlayer\u001b0\u001b\u001bDamage\u001b0\u001b0","o":""},"TeleportPlayerToPosition":{"i":"\u001bRotation\u001b0\u001b0,0,0\u001bPlayer\u001b0\u001b\u001bPosition\u001b0\u001b0,0,0","o":""},"TeleportToPlace":{"i":"\u001bPlayer\u001b0\u001b\u001bPlaceId\u001b0\u001b","o":""},"TeleportToPlaceProtected":{"i":"\u001bNewServer\u001b0\u001b0\u001bPlaceId\u001b0\u001b\u001bSoloServer\u001b0\u001b0\u001bPlayer\u001b0\u001b","o":""},"TestStatusChanged":{"i":"","o":"\u001bStatus\u001b"},"TextBoxCaptureFocus":{"i":"\u001bTextBox\u001b0\u001bscript.Parent.TextBox","o":""},"TextBoxFocused":{"i":"\u001bTextBox\u001b0\u001b","o":""},"TextBoxFocusLost":{"i":"\u001bTextBox\u001b0\u001b","o":"\u001bEnterPressed\u001b"},"ToEulerAnglesXYZ":{"i":"\u001bCFrame\u001b0\u001b","o":"\u001brz\u001b\u001brx\u001b\u001bry\u001b"},"ToggleMobileControls":{"i":"\u001bEnabled\u001b0\u001b0","o":""},"ToNumberAny":{"i":"\u001bInput\u001b1\u001b1000\u001bString","o":"\u001bNumber\u001bNumber"},"ToObjectSpace1":{"i":"\u001bObjectCFrame\u001b0\u001b\u001bCFrame\u001b0\u001b","o":"\u001bResult\u001bResult"},"ToolEquipped":{"i":"\u001bTool\u001b0\u001bscript.Parent","o":"\u001bEventConnection\u001bConnection"},"ToStringAny":{"i":"\u001bInput\u001b1\u001b64\u001bNumber","o":"\u001bString\u001bString"},"ToWorldSpace1":{"i":"\u001bObjectCFrame\u001b0\u001b\u001bCFrame\u001b0\u001b","o":"\u001bResult\u001bResult"},"TweenObjectProperty":{"i":"\u001bRepeatCount\u001b0\u001b0\u001bEasingStyle\u001b0\u001bSine\u001bObject\u001b0\u001bscript.Parent\u001bReverses\u001b0\u001b0\u001bValue\u001b1\u001b0,0,0\u001bVector3\u001bProperty\u001b0\u001bPosition\u001bTime\u001b0\u001b3\u001bEasingDirection\u001b0\u001bOut","o":""},"TypeOf":{"i":"\u001bVariable\u001b1\u001b1\u001bBool","o":"\u001bType\u001bWhatType"},"UnbanPlayerUID":{"i":"\u001bUserId\u001b0\u001b0","o":""},"Upper":{"i":"\u001bString\u001b0\u001btehee","o":"\u001bResult\u001bUpper"},"Vector3Cross":{"i":"\u001bVectorA\u001b0\u001b0,0,0\u001bVectorB\u001b0\u001b0,0,0","o":"\u001bResult\u001bErrm"},"Vector3Dot":{"i":"\u001bVectorA\u001b0\u001b0,0,0\u001bVectorB\u001b0\u001b0,0,0","o":"\u001bResult\u001bVectorDotResult"},"Wait":{"i":"\u001bTime\u001b0\u001b0.21","o":""},"WaitForChild":{"i":"\u001bTimeOut\u001b0\u001b5\u001bChildName\u001b0\u001bLocalScript\u001bParent\u001b0\u001bscript.Parent","o":"\u001bResult\u001bFoundObject"},"Warn":{"i":"\u001bText\u001b0\u001bwarned","o":""},"WhileLoop3":{"i":"\u001bValue 1\u001b1\u001b\u001bString\u001bValue 2\u001b1\u001b\u001bString\u001bComparisonType\u001b0\u001b==","o":""}};

const SUB = '\x1a', ESC = '\x1b';
const HEADER = SUB + '0000000000000004' + ESC;
const B93 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&'()*+,-./:;<=>?@[]^_`{|}~ ";

function encodeBase93(buf) {
  let queue = 0n, bits = 0n, out = '';
  for (const byte of buf) {
    queue += BigInt(byte) << bits; bits += 8n;
    while (bits > 13n) {
      let value = queue & 0x1fffn;
      if (value > 456n) { queue >>= 13n; bits -= 13n; }
      else { value = queue & 0x3fffn; queue >>= 14n; bits -= 14n; }
      out += B93[Number(value % 93n)] + B93[Number(value / 93n)];
    }
  }
  if (bits) {
    out += B93[Number(queue % 93n)];
    if (bits > 7n || queue > 92n) out += B93[Number(queue / 93n)];
  }
  return out;
}
function decodeBase93(str) {
  const lut = new Map([...B93].map((c, i) => [c, i]));
  let queue = 0n, bits = 0n, value = -1, out = [];
  for (const ch of str) {
    if (!lut.has(ch)) throw new Error('bad base-93 character');
    if (value < 0) { value = lut.get(ch); continue; }
    value += lut.get(ch) * 93;
    queue |= BigInt(value) << bits;
    bits += (value & 0x1fff) > 456 ? 13n : 14n;
    while (bits >= 8n) { out.push(Number(queue & 0xffn)); queue >>= 8n; bits -= 8n; }
    value = -1;
  }
  if (value >= 0) {
    queue |= BigInt(value) << bits; bits += 7n;
    while (bits >= 8n) { out.push(Number(queue & 0xffn)); queue >>= 8n; bits -= 8n; }
  }
  return Buffer.from(out);
}
const deflateRaw = s => deflateRawSync(Buffer.from(s, 'latin1'), { level: 6 });
const envelope = s => HEADER + encodeBase93(deflateRaw(s));

const esc = v => String(v).replace(/[\x00-\x1f\x7f]/g, '');
const NUM = /^-?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?)$/;
const isNumber = v => NUM.test(String(v).trim());
function parseNum(raw) {
  const r = raw.replace(/_/g, '').trim();
  if (/^-?0[xX]/.test(r)) return Math.trunc(parseInt(r.replace(/^(-?)0[xX]/, '$10x'), 16)) * (r.startsWith('-') ? 1 : 1);
  if (/^-?0[bB]/.test(r)) return (r.startsWith('-') ? -1 : 1) * parseInt(r.replace(/^-?0[bB]/, ''), 2);
  return Math.trunc(parseFloat(r));
}
function hexNumber(v) {
  const raw = v.replace(/_/g, '').trim();
  let n;
  if (/^-?0[xX]/.test(raw)) n = (raw.startsWith('-') ? -1 : 1) * parseInt(raw.replace(/^-?0[xX]/, ''), 16);
  else if (/^-?0[bB]/.test(raw)) n = (raw.startsWith('-') ? -1 : 1) * parseInt(raw.replace(/^-?0[bB]/, ''), 2);
  else n = Math.trunc(parseFloat(raw));
  return Math.max(0, n).toString(16).toUpperCase();
}
function typedValue(value) {
  const v = value.trim();
  if (NUM.test(v)) return ESC + '1' + ESC + hexNumber(v) + ESC + 'Number';
  if (v.length >= 2 && '"\''.includes(v[0]) && v[v.length - 1] === v[0]) return ESC + '1' + ESC + esc(v.slice(1, -1)) + ESC + 'String';
  if (v === 'true') return ESC + '1' + ESC + '1' + ESC + 'Bool';
  if (v === 'false') return ESC + '1' + ESC + '0' + ESC + 'Bool';
  if (v === 'nil') return ESC + '1' + ESC + ESC + 'Nil';
  return ESC + '2' + ESC + esc(v);
}
function position(i) {
  let x = i * 3, y = 0;
  if (x > 36) { y = 4; x -= 37; }
  return x.toString(16).toUpperCase() + '.0,' + y.toString(16).toUpperCase() + '.0';
}
function serialize(b) {
  const child = b.child ? ESC + b.child : '';
  const elseChild = ESC + (b.elseChild || 'nil');
  return SUB + SUB + 'Block' + SUB + 'Type' + ESC + b.type + SUB + 'Name' + ESC + b.name + SUB + 'VisualPosition' + ESC + b.position
    + SUB + 'ChildBlocks' + child + SUB + 'ElseChildBlock' + elseChild + SUB + 'Inputs' + b.inputs + SUB + 'Outputs' + b.outputs;
}
const editor = () => SUB + SUB + 'Editor' + SUB + 'CameraPosition' + ESC + '2.3F,0.3BF' + SUB + 'CameraZoom' + ESC + '0.C2';

function colorComponentHex2(v) {
  const n = Math.max(0, Math.min(255, parseNum(v)));
  return n.toString(16).toUpperCase().padStart(2, '0');
}
// Legacy colour channel: the exact binary value of the double n/255, written in hex (mirrors float.as_integer_ratio()).
function asIntegerRatio(x) {
  const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (exp === 0) e = -1074; else { mant |= 1n << 52n; e = exp - 1075; }
  let num = mant, den = 1n;
  if (e >= 0) num <<= BigInt(e); else den <<= BigInt(-e);
  while (num % 2n === 0n && den % 2n === 0n && den > 1n) { num >>= 1n; den >>= 1n; }
  return [num, den];
}
function legacyColor(v) {
  const n = Math.max(0, Math.min(255, parseNum(v)));
  if (n === 0 || n === 255) return String(n / 255);
  let [num, den] = asIntegerRatio(n / 255);
  let digits = '';
  while (num) { num *= 16n; digits += (num / den).toString(16).toUpperCase(); num = num % den; }
  return '0.' + digits;
}
const isSimpleValue = v => /^(?:-?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?)|true|false|nil|['"][^'"]*['"]|[\w.]+)$/.test(v.trim());

function normalizeModern(src) {
  let s = src.replace(/\r\n?/g, '\n');
  s = s.replace(/^\s*--![^\n]*$/gm, '');
  s = s.replace(/\bconst\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=/g, 'local $1 =');
  s = s.replace(/\blocal\s+(\w+)\s*:\s*[^=\n]+\s*=/g, 'local $1 =');
  return s;
}
function stripTrailingComment(line) {
  let quote = null;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (c === '"' || c === "'") quote = quote === c ? null : (quote === null ? c : quote);
    if (quote === null && line.slice(i, i + 2) === '--') return line.slice(0, i).trim();
  }
  return line;
}
function conditionInputs(expr) {
  const m = /^(.+?)\s*(==|~=|>=|<=|>|<)\s*(.+)$/.exec(expr.trim());
  if (m) return ESC + 'Value 1' + typedValue(m[1]) + ESC + 'Value 2' + typedValue(m[3]) + ESC + 'ComparisonType' + ESC + '0' + ESC + m[2];
  return ESC + 'Value 1' + typedValue(expr) + ESC + 'Value 2' + typedValue('true') + ESC + 'ComparisonType' + ESC + '0' + ESC + '==';
}
function parseOverrides(raw) {
  const o = {};
  if (!raw.trim()) return o;
  for (const item of raw.split(',')) {
    const i = item.indexOf('=');
    if (i < 0 || !item.slice(0, i).trim() || !item.slice(i + 1).trim()) throw new Error('bad override');
    o[item.slice(0, i).trim()] = item.slice(i + 1).trim();
  }
  return o;
}
function catalogInputs(template, overrides) {
  const t = template.split(ESC);
  let pos = 1, out = '';
  while (pos < t.length && t[pos] !== '') {
    const field = t[pos], kindRaw = t[pos + 1] !== undefined ? t[pos + 1] : '0';
    let kind = kindRaw, value = t[pos + 2] !== undefined ? t[pos + 2] : '';
    pos += 3;
    let typeName = '';
    if (kind === '1' && pos < t.length) { typeName = t[pos]; pos += 1; }
    const ov = overrides[field];
    if (ov !== undefined) {
      if (kind === '0') value = ov.length >= 2 && '"\''.includes(ov[0]) && ov[ov.length - 1] === ov[0] ? ov.slice(1, -1) : ov;
      else { const tv = typedValue(ov).split(ESC); kind = tv[1]; value = tv[2]; typeName = tv.length > 3 ? tv[3] : ''; }
    }
    out += ESC + field + ESC + kind + ESC + esc(value);
    if (kind === '1' && typeName) out += ESC + esc(typeName);
  }
  return out;
}

function compile(source) {
  const blocks = [], skipped = [], counters = {}, open = [], top = [];
  const kids = {}, elseKids = {}, activeElse = new Set(), loopStep = {};
  let skipFn = null, skipDepth = 0;
  const add = (type, label, inputs = '', outputs = '') => {
    counters[label] = (counters[label] || 0) + 1;
    const b = { type, name: label + counters[label], position: position(blocks.length), inputs, outputs, child: null, elseChild: null };
    blocks.push(b);
    if (open.length) { const a = open[open.length - 1]; const map = activeElse.has(a.name) ? elseKids : kids; (map[a.name] = map[a.name] || []).push(b); }
    else top.push(b);
    return b;
  };
  const setProp = (obj, prop, valueRef) => add('SetObjectProperty', 'Set Object Property',
    ESC + 'Value' + valueRef + ESC + 'Property' + ESC + '0' + ESC + prop + ESC + 'Object' + ESC + '0' + ESC + obj);
  const ref = name => ESC + '2' + ESC + name;

  for (const rawLine of normalizeModern(source).split('\n')) {
    let line = rawLine.trim(), m;
    if (!line) continue;
    if ((m = /^--@block\s+(\w+)(?:\s+(.*))?$/.exec(line))) {
      const tpl = Object.prototype.hasOwnProperty.call(CATALOG, m[1]) ? CATALOG[m[1]] : null;
      if (!tpl) { skipped.push('Skipped unknown private catalog block: ' + m[1]); continue; }
      try { add(m[1], m[1], catalogInputs(tpl.i, parseOverrides(m[2] || '')), tpl.o); }
      catch { skipped.push('Skipped malformed private catalog directive: ' + m[1]); }
      continue;
    }
    if (line.startsWith('--')) continue;
    line = stripTrailingComment(line);
    if (!line) continue;
    if (skipFn !== null) {
      if (line === 'end') {
        skipDepth -= 1;
        if (skipDepth === 0) { skipped.push('Skip: ' + skipFn.join('')); skipped.push('Skip: end'); skipFn = null; }
        else skipFn.push(line);
        continue;
      }
      skipFn.push(line);
      if (/^(?:local\s+)?function\s+\w+\s*\(.*\)$/.test(line) || /^(?:if|for|while)\b.*(?:then|do)$/.test(line)) skipDepth += 1;
      continue;
    }
    if (/^local\s+function\s+\w+\s*\(.*\)$/.test(line)) { skipFn = [line]; skipDepth = 1; continue; }

    m = /^for\s+(\w+)\s*=\s*([^,]+)\s*,\s*([^,\s]+)(?:\s*,\s*([^\s]+))?\s+do$/.exec(line);
    if (m && isNumber(m[2]) && isNumber(m[3])) {
      const [, v, start, finish, step] = m;
      add('SetVariable1', 'Init ' + v, ESC + 'Value' + typedValue(start), ESC + 'VariableName' + ESC + v);
      const loop = add('WhileLoop3', 'While Loop', ESC + 'Value 1' + typedValue(v) + ESC + 'Value 2' + typedValue(finish) + ESC + 'ComparisonType' + ESC + '0' + ESC + '<=');
      loopStep[loop.name] = [v, step || '1'];
      open.push(loop);
      continue;
    }
    if ((m = /^if\s+(.+)\s+then$/.exec(line))) { open.push(add('If', 'If', conditionInputs(m[1]))); continue; }
    if ((line === 'end' || line === 'end)') && open.length) {
      const closed = open.pop();
      activeElse.delete(closed.name);
      if (loopStep[closed.name]) {
        const [v, step] = loopStep[closed.name];
        open.push(closed);
        add('Addition', 'Step ' + v, ESC + 'Number1' + typedValue(v) + ESC + 'Number2' + typedValue(step), ESC + 'Result' + ESC + v);
        open.pop();
      }
      continue;
    }
    if (line === 'else' && open.length && open[open.length - 1].type === 'If') { activeElse.add(open[open.length - 1].name); continue; }
    if (line.startsWith('elseif ')) { skipped.push('Skipped unsupported control-flow branch: ' + line.slice(0, 72)); continue; }
    if ((m = /^([\w.]+)\.Touched\s*:\s*Connect\s*\(\s*function\s*\(\s*(\w+)\s*\)\s*$/.exec(line))) {
      open.push(add('PartTouched', 'Part Touched', ESC + 'Part' + ESC + '0' + ESC + m[1], ESC + 'otherPart' + ESC + m[2] + ESC + 'EventConnection' + ESC + 'touchConn'));
      continue;
    }
    if ((m = /^([\w.]+)\.MouseButton1Click\s*:\s*Connect\s*\(\s*function\s*\(\s*\)\s*$/.exec(line))) {
      open.push(add('GUILeftMouseButtonClick', 'GUI Left Click', ESC + 'GUIButton' + ESC + '0' + ESC + m[1]));
      continue;
    }
    if ((m = /^print\s*\(\s*(['"])(.*?)\1\s*\)$/.exec(line))) { add('Print', 'Print', ESC + 'Text' + ESC + '0' + ESC + esc(m[2])); continue; }
    if ((m = /^print\s*\(\s*([\w.]+)\s*\)$/.exec(line))) { add('Print', 'Print', ESC + 'Text' + typedValue(m[1])); continue; }
    if ((m = /^(?:task\.)?wait\s*\(\s*([^)]*)\s*\)$/.exec(line))) { add('Wait', 'Wait', ESC + 'Time' + typedValue(m[1].trim() || '0.03')); continue; }
    m = /^local\s+(\w+)\s*=\s*Color3ToBrickColor\s*\(\s*Color3\.fromRGB\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*\)$/.exec(line);
    if (m && [m[2], m[3], m[4]].every(isNumber)) {
      add('Color3ToBrickColor', 'Color3 to BrickColor', ESC + 'Color3' + ESC + '0' + ESC + [m[2], m[3], m[4]].map(colorComponentHex2).join(','), ESC + 'BrickColor' + ESC + m[1]);
      continue;
    }
    if ((m = /^local\s+(\w+)\s*=\s*Vector3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line))) {
      add('ConstructVector3', 'Vector3', ESC + 'X' + typedValue(m[2]) + ESC + 'Y' + typedValue(m[3]) + ESC + 'Z' + typedValue(m[4]), ESC + 'Vector3' + ESC + m[1]);
      continue;
    }
    if ((m = /^local\s+(\w+)\s*=\s*\{\s*\}$/.exec(line))) { add('CreateTable', 'Create Table', '', ESC + 'TableVariable' + ESC + m[1]); continue; }
    if ((m = /^local\s+(\w+)\s*=\s*Instance\.new\s*\(\s*(['"])(\w+)\2\s*,\s*([\w.]+)\s*\)$/.exec(line))) {
      add('CreateObject', 'Create Object', ESC + 'Parent' + ESC + '0' + ESC + m[4] + ESC + 'ClassName' + ESC + '0' + ESC + m[3], ESC + 'Object' + ESC + m[1]);
      continue;
    }
    if ((m = /^local\s+(\w+)\s*=\s*Instance\.new\s*\(\s*(['"])(\w+)\2\s*\)$/.exec(line))) {
      add('CreateObject', 'Create Object', ESC + 'Parent' + ESC + '0' + ESC + 'script.Parent' + ESC + 'ClassName' + ESC + '0' + ESC + m[3], ESC + 'Object' + ESC + m[1]);
      continue;
    }
    if ((m = /^local\s+(\w+)\s*=\s*(.+)$/.exec(line)) && isSimpleValue(m[2])) {
      add('SetVariable1', 'Set Variable', ESC + 'Value' + typedValue(m[2]), ESC + 'VariableName' + ESC + m[1]);
      continue;
    }
    m = /^([\w.]+)\.(Size|Position)\s*=\s*UDim2\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[3], m[4], m[5], m[6]].every(isNumber)) {
      const [, obj, prop, xs, xo, ys, yo] = m;
      add('ConstructUDim2', 'Construct UDim2', ESC + 'XOffset' + typedValue(xo) + ESC + 'XScale' + typedValue(xs) + ESC + 'YScale' + typedValue(ys) + ESC + 'YOffset' + typedValue(yo), ESC + 'UDim2' + ESC + '_udim0');
      setProp(obj, prop, ref('_udim0'));
      continue;
    }
    m = /^([\w.]+)\.(BackgroundColor3|TextColor3|ImageColor3)\s*=\s*Color3\.fromRGB\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[3], m[4], m[5]].every(isNumber)) {
      const c = [m[3], m[4], m[5]].map(legacyColor);
      add('ConstructColor3', 'Construct Color3', ESC + 'R' + ESC + '1' + ESC + c[0] + ESC + 'Number' + ESC + 'G' + ESC + '1' + ESC + c[1] + ESC + 'Number' + ESC + 'B' + ESC + '1' + ESC + c[2] + ESC + 'Number', ESC + 'Color3' + ESC + '_color0');
      setProp(m[1], m[2], ref('_color0'));
      continue;
    }
    m = /^([\w.]+)\.(BackgroundColor3|TextColor3|ImageColor3)\s*=\s*Color3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[3], m[4], m[5]].every(isNumber)) {
      const c = [m[3], m[4], m[5]].map(hexNumber);
      add('ConstructColor3', 'Construct Color3', ESC + 'R' + ESC + '1' + ESC + c[0] + ESC + 'Number' + ESC + 'G' + ESC + '1' + ESC + c[1] + ESC + 'Number' + ESC + 'B' + ESC + '1' + ESC + c[2] + ESC + 'Number', ESC + 'Color3' + ESC + '_color0');
      setProp(m[1], m[2], ref('_color0'));
      continue;
    }
    m = /^([\w.]+)\.CFrame\s*=\s*CFrame\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[2], m[3], m[4]].every(isNumber)) {
      add('ConstructCFrame', 'CFrame', ESC + 'Rotation' + ESC + '0' + ESC + '0,0,0' + ESC + 'Position' + ESC + '0' + ESC + [m[2], m[3], m[4]].map(s => s.trim()).join(','), ESC + 'CFrame' + ESC + '_cframe0');
      setProp(m[1], 'CFrame', ref('_cframe0'));
      continue;
    }
    m = /^([\w.]+)\.(\w+)\s*=\s*Vector3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[3], m[4], m[5]].every(isNumber)) {
      add('ConstructVector3', 'Vector3', ESC + 'X' + typedValue(m[3]) + ESC + 'Y' + typedValue(m[4]) + ESC + 'Z' + typedValue(m[5]), ESC + 'Vector3' + ESC + '_vector0');
      setProp(m[1], m[2], ref('_vector0'));
      continue;
    }
    if ((m = /^([\w.]+)\.BrickColor\s*=\s*BrickColor\.new\s*\(\s*(['"])(.*?)\2\s*\)$/.exec(line))) { setProp(m[1], 'BrickColor', typedValue('"' + m[3] + '"')); continue; }
    if ((m = /^([\w.]+)\.Material\s*=\s*Enum\.Material\.(\w+)$/.exec(line))) { setProp(m[1], 'Material', typedValue('"' + m[2] + '"')); continue; }
    if ((m = /^([\w.]+)\.(\w+)\s*=\s*(.+)$/.exec(line)) && isSimpleValue(m[3])) { setProp(m[1], m[2], typedValue(m[3])); continue; }
    if ((m = /^(\w+)\s*\[\s*(.+)\s*\]\s*=\s*(.+)$/.exec(line)) && isSimpleValue(m[2]) && isSimpleValue(m[3])) {
      add('SetTableValue', 'Set Table Value', ESC + 'Value' + typedValue(m[3]) + ESC + 'Key' + typedValue(m[2]) + ESC + 'Table' + ESC + '0' + ESC + m[1]);
      continue;
    }
    skipped.push('Skip: ' + line.slice(0, 72));
  }

  const ordered = b => {
    const out = [], c = kids[b.name] || [], e = elseKids[b.name] || [];
    if (b.type === 'WhileLoop3' && c.length) { out.push(...ordered(c[0])); out.push(b); for (const k of c.slice(1)) out.push(...ordered(k)); return out; }
    for (const k of c) out.push(...ordered(k));
    for (const k of e) out.push(...ordered(k));
    out.push(b);
    return out;
  };
  const link = seq => {
    seq.forEach((b, i) => {
      b.child = i + 1 < seq.length ? seq[i + 1].name : null;
      const c = kids[b.name] || [];
      if (c.length) { b.child = c[0].name; link(c); }
      const e = elseKids[b.name] || [];
      if (e.length) { b.elseChild = e[0].name; link(e); }
    });
  };
  link(top);
  const flat = [];
  for (let i = 0; i < top.length;) {
    const b = top[i], next = top[i + 1];
    if (next && next.type === 'WhileLoop3' && loopStep[next.name]) {
      const lc = kids[next.name] || [];
      if (lc.length) { flat.push(...ordered(lc[0])); flat.push(b); flat.push(next); for (const k of lc.slice(1)) flat.push(...ordered(k)); i += 2; continue; }
    }
    flat.push(...ordered(b)); i += 1;
  }
  flat.forEach((b, i) => { b.position = position(i); });
  const root = { type: 'Comment2', name: 'ROOT', position: '-10.0,-10.0', inputs: ESC + 'Color' + ESC + '0' + ESC + '3FC' + ESC + 'Comment' + ESC + '0' + ESC + 'ROOT', outputs: '', child: top.length ? top[0].name : null, elseChild: null };
  const serialized = editor() + serialize(root) + flat.map(serialize).join('');
  return { serialized, encoded: envelope(serialized), blocks: flat.length, skipped };
}

// Decode a string back to its block count (used to sanity check what we hand to the user).
function check(encoded) {
  if (typeof encoded !== 'string' || !encoded.startsWith(HEADER)) return { valid: false, blocks: 0 };
  try {
    const raw = inflateRawSync(decodeBase93(encoded.slice(HEADER.length)), { maxOutputLength: 4 * 1024 * 1024 }).toString('latin1');
    if (!raw.startsWith(SUB + SUB + 'Editor')) return { valid: false, blocks: 0 };
    return { valid: true, blocks: Math.max(0, raw.split(SUB + SUB + 'Block').length - 1 - 1) };
  } catch { return { valid: false, blocks: 0 }; }
}
const blockNames = () => Object.keys(CATALOG);


const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const send = (code: number, obj: unknown) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', ...cors } });
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return send(405, { error: 'Use POST.' });
  let b: any = {}; try { b = await req.json(); } catch { return send(400, { error: 'Send JSON like {"source":"..."}.' }); }
  const source = String((b && b.source) || '');
  if (!source.trim()) return send(400, { error: 'Paste or generate some Luau first.' });
  if (source.length > 100000) return send(413, { error: 'That script is too long (max 100,000 characters).' });
  try {
    const r = compile(source);
    if (!r.blocks) return send(422, { error: 'Nothing in that script could be turned into blocks.', skipped: r.skipped.slice(0, 40) });
    return send(200, { encoded: r.encoded, blocks: r.blocks, skipped: r.skipped.slice(0, 40) });
  } catch { return send(500, { error: 'The encoder could not process that script.' }); }
});
