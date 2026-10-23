const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const http = require("http");
const { spawn } = require("child_process");

const PATCH_MARKER = "agy-chat-tabs-bar";
const PATCH_VERSION = "agy-chat-tabs-v1.6.14";
const MAIN_PATCH_MARKER = "AGY_GRAVITO_OVERLAY_SCRIPT";
const OVERLAY_PORT = 47831;
const OVERLAY_VERSION = "1.6.14";

function isSpanishEnv() {
  try {
    return String(vscode.env?.language || "en").toLowerCase().startsWith("es");
  } catch (e) {
    return false;
  }
}

function getIdeFiles() {
  const appRoot = vscode.env.appRoot;
  const workbenchJs = path.join(appRoot, "out", "vs", "workbench", "workbench.desktop.main.js");
  const mainJs = path.join(appRoot, "out", "main.js");
  const overlayDest = path.join(appRoot, "out", "agy-gravito-overlay.mjs");
  const productJson = path.join(appRoot, "product.json");
  return {
    appRoot,
    workbenchJs,
    mainJs,
    overlayDest,
    productJson,
    wbBak: workbenchJs + ".bak",
    mainBak: mainJs + ".bak",
    prodBak: productJson + ".bak",
  };
}

function computeVscodeChecksum(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("base64").replace(/=+$/, "");
}

function extract(pattern, text, name) {
  const m = pattern.exec(text);
  if (!m) {
    throw new Error(`Could not extract ${name} using ${pattern}`);
  }
  return m[1];
}

function buildMainPatch(content) {
  let patched = content;
  const startMarker = 'ece(),Qd("code/didStartMain")';
  const endMarker = "else Rcs()});";
  const sIdx = patched.indexOf(startMarker);
  const eIdx = sIdx !== -1 ? patched.indexOf(endMarker, sIdx) : -1;
  if (sIdx !== -1 && eIdx !== -1 && !patched.includes(MAIN_PATCH_MARKER)) {
    patched =
      patched.slice(0, sIdx) +
      `if(process.env.${MAIN_PATCH_MARKER}){globalThis._agyElectron=QRt;import("url").then(u=>import(u.pathToFileURL(process.env.${MAIN_PATCH_MARKER}).href)).catch(e=>{console.error(e);process.exit(1)})}else{` +
      patched.slice(sIdx, eIdx + endMarker.length) +
      "}" +
      patched.slice(eIdx + endMarker.length);
  }

  patched = patched.replace(
    "doFocusWindow(){const t=this.win;t&&(t.isMinimized()&&t.restore(),t.focus())}",
    'doFocusWindow(){const t=this.win;if(t){if(t.isMinimized())t.restore();t.show();if(process.platform==="win32"&&!t.isAlwaysOnTop()){t.setAlwaysOnTop(!0);t.focus();t.moveTop();t.setAlwaysOnTop(!1)}else{t.focus()}}}'
  );

  return patched;
}

function buildDynamicPatch(content) {
  const anchor = content.indexOf('"new-conversation-tooltip"');
  if (anchor === -1) {
    throw new Error('Could not locate "new-conversation-tooltip" in workbench.desktop.main.js');
  }

  const searchStart = Math.max(0, anchor - 4000);
  const compStart = content.lastIndexOf("{closeAgentPanel:", anchor);
  if (compStart === -1 || compStart < searchStart) {
    throw new Error("Could not locate {closeAgentPanel: before new-conversation-tooltip");
  }

  const sliceBefore = content.slice(Math.max(0, compStart - 60), compStart + 30);
  const fnMatch = /([A-Za-z0-9_$]+)=\(\)=>\{let\{closeAgentPanel:/.exec(sliceBefore);
  if (!fnMatch) {
    throw new Error("Could not locate header component function declaration");
  }
  const fnStart = Math.max(0, compStart - 60) + fnMatch.index;

  const sliceAfter = content.slice(anchor, anchor + 4000);
  const nextFn = /,[A-Za-z0-9_$]+=\(\)=>\{let /.exec(sliceAfter);
  if (!nextFn) {
    throw new Error("Could not locate end of header component");
  }
  const fnEnd = anchor + nextFn.index;

  const origFn = content.slice(fnStart, fnEnd);
  const retSplit = origFn.indexOf(";return ");
  if (retSplit === -1) {
    throw new Error("Could not find `;return ` in header component");
  }

  const preamble = origFn.slice(0, retSplit);
  const returnBody = origFn.slice(retSplit + ";return ".length);

  const ofFn = extract(/\{closeAgentPanel:[^}]+\}=([A-Za-z0-9_$]+)\(\)/, preamble, "Of");
  const nlFn = extract(/=([A-Za-z0-9_$]+)\([A-Za-z0-9_$]+\),_=([A-Za-z0-9_$]+)\(/, preamble, "nl");
  const setCascadeVar = extract(/setCascadeId:([A-Za-z0-9_$]+)/, preamble, "setCascadeId");
  const agentStateVar = extract(/agentStateProvider:([A-Za-z0-9_$]+)/, preamble, "agentStateProvider (a)");
  const startNewVar = extract(/\{startNewConversation:([A-Za-z0-9_$]+)\}/, preamble, "startNewConversation");
  const cascadeIdVar = extract(/([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+,"Agent"\)/, preamble, "F (title)");
  const curIdVar = extract(/[A-Za-z0-9_$]+=[A-Za-z0-9_$]+\(([A-Za-z0-9_$]+),"Agent"\)/, preamble, "d (currentCascadeId)");
  const parentTitleVar = extract(/([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+,"Parent"\)/, preamble, "T (parentTitle)");
  const parentIdVar = extract(/[A-Za-z0-9_$]+=[A-Za-z0-9_$]+\(([A-Za-z0-9_$]+),"Parent"\)/, preamble, "u (parentId)");
  const useMemoFn = extract(/=([A-Za-z0-9_$]+)\(\(\)=>\[/, preamble, "useMemo (Re)");
  const useCbFn = extract(/=([A-Za-z0-9_$]+)\(async\(\)=>\{/, preamble, "useCallback (me)");
  const useStateFn = extract(/\[[A-Za-z0-9_$]+,[A-Za-z0-9_$]+\]=([A-Za-z0-9_$]+)\(!1\)/, preamble, "useState (We)");
  const activeTabVar = extract(/([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+=>[A-Za-z0-9_$]+\.agentTab\.activeTab\)/, preamble, "_ (activeTab)");
  const isNewVar = extract(new RegExp("([A-Za-z0-9_$]+)=" + activeTabVar.replace(/\$/g, "\\$") + '==="conversation"&&!' + curIdVar.replace(/\$/g, "\\$")), preamble, "G (isNew)");

  const jsxFn = extract(/^([A-Za-z0-9_$]+)\("div"/, returnBody, "jsx (E)");
  const iconComp = extract(new RegExp(jsxFn.replace(/\$/g, "\\$") + '\\(([A-Za-z0-9_$]+),\\{name:"arrow_back"'), returnBody, "Icon ($e)");
  const backToConvExpr = extract(/onClick:\(\)=>\{([A-Za-z0-9_$]+\([A-Za-z0-9_$]+\("conversation"\)\))\}/, returnBody, "y(ove('conversation'))");

  const nearby = content.slice(Math.max(0, fnStart - 6000), Math.min(content.length, fnEnd + 6000));
  const useEffectFn = extract(/([A-Za-z0-9_$]+)\(\(\)=>\{if\(/, nearby, "useEffect (yt)");
  const useRefFn = extract(/=([A-Za-z0-9_$]+)\(null\)/, nearby, "useRef (mt)");

  const w7uRegion = content.slice(Math.max(0, fnStart - 25000), fnStart);
  const getAspMatch = /=([A-Za-z0-9_$]+)\(\),[A-Za-z0-9_$]+=[A-Za-z0-9_$]+\(\(\)=>[A-Za-z0-9_$]+\?[A-Za-z0-9_$]+\([A-Za-z0-9_$]+\):\{getState:\(\)=>/.exec(w7uRegion);
  const getAspFn = getAspMatch ? getAspMatch[1] : null;

  const wmAnchor = content.indexOf('"__original_cortex_step"');
  const wmSlice = wmAnchor !== -1 ? content.slice(wmAnchor, wmAnchor + 15000) : "";
  const wmMatch = /function ([A-Za-z0-9_$]+)\([A-Za-z0-9_$]+\)\{if\([A-Za-z0-9_$]+\.step\.case!=="generic"\)return [A-Za-z0-9_$]+;/.exec(wmSlice);
  const wmFn = wmMatch ? wmMatch[1] : null;

  const qxeAnchor = content.indexOf('"contentTarget"');
  const qxeSlice = qxeAnchor !== -1 ? content.slice(Math.max(0, qxeAnchor - 500), qxeAnchor + 1500) : "";
  const qxeMatch = /([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+=>\{if\(![A-Za-z0-9_$]+\)return;let [A-Za-z0-9_$]+=[A-Za-z0-9_$]+\.actionSpec;/.exec(qxeSlice);
  const qxeFn = qxeMatch ? qxeMatch[1] : null;

  const portalMatch = /createPortal:\(\)=>([A-Za-z0-9_$]+)/.exec(content);
  const createPortalFn = portalMatch ? portalMatch[1] : null;

  const nhMatch = /focus\([A-Za-z0-9_$]+,[A-Za-z0-9_$]+\)\{return this\.nativeHostService\.focusWindow\([\s\S]{1,700}?Bi\(([A-Za-z0-9_$]+),[A-Za-z0-9_$]+,1\);async function/.exec(content);
  const nativeHostToken = nhMatch ? nhMatch[1] : null;

  const actionsMarker = 'className:"flex items-center gap-2 px-0.5",children:[';
  const actionsIdx = returnBody.indexOf(actionsMarker);
  if (actionsIdx === -1) {
    throw new Error("Could not find right-side actions container in header component");
  }
  const actionsChildren = returnBody.slice(actionsIdx + actionsMarker.length, -7);

  const backBtnStart = returnBody.indexOf("?") + 1;
  const backBtnEnd = returnBody.indexOf(`:${jsxFn}(`, backBtnStart);
  const backBtnJsx = returnBody.slice(backBtnStart, backBtnEnd);

  const normHelper = `(raw=>{try{let p=typeof raw==="string"?JSON.parse(raw):raw;if(p&&typeof p==="object")return{openIds:Array.isArray(p.openIds)?p.openIds:[],closedIds:Array.isArray(p.closedIds)?p.closedIds:[],pinnedIds:Array.isArray(p.pinnedIds)?p.pinnedIds:[],customTitles:p.customTitles&&typeof p.customTitles==="object"?p.customTitles:{}}}catch(e){}return{openIds:[],closedIds:[],pinnedIds:[],customTitles:{}}})`;

  const i18nHelper = `(()=>{let lang=String(Intl.DateTimeFormat().resolvedOptions().locale||window.navigator?.language||document.documentElement?.lang||"es").toLowerCase();return lang.startsWith("es")?{lang:"es",newSession:"Nueva sesión",newSessionTip:"Nueva conversación en paralelo (Ctrl+Shift+L)",backParent:"Volver al padre",unpinTip:"Desfijar pestaña",pinTip:"Fijar pestaña",closeTip:"Cerrar pestaña",tabHint:"(Doble clic para renombrar · Clic derecho para opciones)",waitDefault:"Requiere tu atención / confirmación",thinkingTip:"Pensando / procesando en paralelo...",doneTip:"Terminó de responder — clic para revisar",doneShort:"Respuesta lista",rename:"✏️ Renombrar pestaña",dblClick:"2×Clic",restoreTitle:"↺ Restaurar título original",pin:"📌 Fijar pestaña al inicio",unpin:"📌 Desfijar pestaña",close:"✕ Cerrar pestaña",closeOthers:"⇄ Cerrar otras pestañas",closeRight:"⇥ Cerrar pestañas a la derecha",reopenLast:"⟲ Reabrir última pestaña cerrada",convFallback:"Conversación",allTabsTip:"Ver y buscar todas las pestañas abiertas",searchTabs:"🔍 Filtrar pestañas...",noTabsMatch:"Sin coincidencias",botTopTip:"Configurar compañero IA flotante",botActiveOn:"🟢 Activo",botActiveOff:"⚪ Apagado",botModeDesktop:"🖥️ En Pantalla",botModeIde:"🪟 En IDE",botReadyTitle:"¡Ya está OK la tarea!",botWaitTitle:"¡Requiere tu atención!",botFilesReady:"archivos listos",botFileReady:"archivo listo",botReplyReady:"Respuesta completada",botSoundOn:"🔊 Sonido",botSoundOff:"🔇 Mudo",botTestBtn:"💬 Probar",botResetPos:"🎯 Traer aquí",botHideBtn:"🙈 Ocultar",botDragTip:"Arrastra para mover · Clic para opciones",botTestTask:"Tarea de prueba lista"}:{lang:"en",newSession:"New Session",newSessionTip:"New parallel conversation (Ctrl+Shift+L)",backParent:"Back to parent",unpinTip:"Unpin tab",pinTip:"Pin tab",closeTip:"Close tab",tabHint:"(Double-click to rename · Right-click for options)",waitDefault:"Needs your attention / confirmation",thinkingTip:"Thinking / processing in parallel...",doneTip:"Finished responding — click to review",doneShort:"Response ready",rename:"✏️ Rename tab",dblClick:"2×Click",restoreTitle:"↺ Restore original title",pin:"📌 Pin tab to start",unpin:"📌 Unpin tab",close:"✕ Close tab",closeOthers:"⇄ Close other tabs",closeRight:"⇥ Close tabs to the right",reopenLast:"⟲ Reopen last closed tab",convFallback:"Conversation",allTabsTip:"View and search all open tabs",searchTabs:"🔍 Filter tabs...",noTabsMatch:"No matching tabs",botTopTip:"Configure floating AI companion",botActiveOn:"🟢 Active",botActiveOff:"⚪ Off",botModeDesktop:"🖥️ On Desktop",botModeIde:"🪟 In IDE",botReadyTitle:"Task is ready!",botWaitTitle:"Needs your input!",botFilesReady:"files ready",botFileReady:"file ready",botReplyReady:"Response completed",botSoundOn:"🔊 Sound",botSoundOff:"🔇 Muted",botTestBtn:"💬 Test",botResetPos:"🎯 Reset pos",botHideBtn:"🙈 Hide",botDragTip:"Drag to move · Click for options",botTestTask:"Sample task completed"}})()`;

  const botCfgHelper = `(raw=>{try{let p=typeof raw==="string"?JSON.parse(raw):raw;if(p&&typeof p==="object"){let sk=p.skin==="aurora"||p.skin==="orbi"?"aurora":p.skin==="solaris"||p.skin==="pixel"?"solaris":"nebula",pr=p.soundPreset==="pulso"||p.soundPreset==="arpa"||p.soundPreset==="zen"||p.soundPreset==="cristal"?p.soundPreset:"cristal";return{x:typeof p.x==="number"?p.x:-1,y:typeof p.y==="number"?p.y:-1,skin:sk,sound:p.sound!==!1,soundPreset:pr,hidden:p.hidden!==!1,desktopMode:p.desktopMode!==!1}}}catch(e){}return{x:-1,y:-1,skin:"nebula",sound:!0,soundPreset:"cristal",hidden:!0,desktopMode:!0}})`;

  const newFn =
    preamble +
    `,_agyServices=${ofFn}(),_agyTs=${nlFn}(_agyServices.trajectorySummariesProvider),_agyWs=${nlFn}(_agyServices.workspaceInfoProvider),_agyCurLiveState=${nlFn}(${agentStateVar})` +
    `,_agyGetAsp=${getAspFn ? `${getAspFn}()` : "null"}` +
    `,_agySummaries=_agyTs?.summaries||{},_agyWsUris=_agyWs?.workspaceUris||[],_agyWsKey="agy_chat_tabs_v2_"+(_agyWsUris[0]||"global")` +
    `,_agyNorm=${normHelper},_agyT=${i18nHelper},_agyNormBot=${botCfgHelper}` +
    `,[_agyTabState,_agySetTabState]=${useStateFn}(()=>_agyNorm(window.localStorage.getItem(_agyWsKey)))` +
    `,[_agyBotCfg,_agySetBotCfg]=${useStateFn}(()=>_agyNormBot(window.localStorage.getItem("agy_gravito_cfg_v2")))` +
    `,[_agyBotAlerts,_agySetBotAlerts]=${useStateFn}([])` +
    `,[_agyBotMenu,_agySetBotMenu]=${useStateFn}(!1)` +
    `,[_agyShowBotTop,_agySetShowBotTop]=${useStateFn}(null)` +
    `,[_agyOverlayOnline,_agySetOverlayOnline]=${useStateFn}(!1)` +
    `,[_agyBotDragging,_agySetBotDragging]=${useStateFn}(!1)` +
    `,[_agyEditingId,_agySetEditingId]=${useStateFn}(null)` +
    `,[_agyEditVal,_agySetEditVal]=${useStateFn}("")` +
    `,[_agyCtxMenu,_agySetCtxMenu]=${useStateFn}(null)` +
    `,[_agyShowDrop,_agySetShowDrop]=${useStateFn}(null)` +
    `,[_agyDropQuery,_agySetDropQuery]=${useStateFn}("")` +
    `,[_agyDragId,_agySetDragId]=${useStateFn}(null)` +
    `,[_agyDragOverId,_agySetDragOverId]=${useStateFn}(null)` +
    `,[_agyUnreadDone,_agySetUnreadDone]=${useStateFn}([])` +
    `,[_agyLiveTick,_agySetLiveTick]=${useStateFn}(0)` +
    `,_agyPrevRunRef=${useRefFn}({})` +
    `,_agyPrevWaitRef=${useRefFn}({})` +
    `,_agyPrevModRef=${useRefFn}({})` +
    `,_agyBotDragRef=${useRefFn}(null)` +
    `,_agyPrevWsKey=${useRefFn}(_agyWsKey);` +
    `window._agyGravitoActive=!_agyBotCfg.hidden;` +
    (nativeHostToken
      ? `if(!window._agyNativeHost&&_agyServices?._instantiationService){try{window._agyNativeHost=_agyServices._instantiationService.invokeFunction(acc=>acc.get(${nativeHostToken}));window._agyNativeHost?.setBackgroundThrottling?.(!1)}catch(e){}}`
      : "") +
    `window._agyRestoreAndFocusIde=async()=>{try{let nh=window._agyNativeHost,wid=nh?.windowId;if(nh){await nh.focusWindow({mode:2,targetWindowId:wid});await nh.setWindowAlwaysOnTop(!0,{targetWindowId:wid});await nh.moveWindowTop({targetWindowId:wid});await nh.focusWindow({mode:2,targetWindowId:wid});setTimeout(()=>{try{nh.setWindowAlwaysOnTop(!1,{targetWindowId:wid})}catch(e){}},160)}}catch(e){}try{window.focus()}catch(e){}};` +
    `window._agyPlayBotTone=(type,preset)=>{try{let Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;if(!window._agyAudioCtx||window._agyAudioCtx.state==="closed")window._agyAudioCtx=new Ctx();if(window._agyAudioCtx.state==="suspended")window._agyAudioCtx.resume().catch(()=>{});let ctx=window._agyAudioCtx,now=ctx.currentTime,pr=preset||"cristal",notes=pr==="pulso"?(type==="wait"?[[698.46,0,0.11,"triangle",0.06],[587.33,0.12,0.11,"triangle",0.06],[698.46,0.24,0.18,"triangle",0.07]]:[[587.33,0,0.09,"triangle",0.06],[880,0.09,0.1,"triangle",0.06],[1174.66,0.19,0.26,"sine",0.075]]):pr==="arpa"?(type==="wait"?[[329.63,0,0.18,"triangle",0.055],[493.88,0.07,0.2,"triangle",0.055],[659.25,0.14,0.28,"sine",0.06]]:[[349.23,0,0.22,"sine",0.045],[440,0.055,0.22,"sine",0.05],[523.25,0.11,0.24,"sine",0.055],[659.25,0.165,0.28,"sine",0.06],[880,0.22,0.38,"sine",0.065]]):pr==="zen"?(type==="wait"?[[261.63,0,0.35,"sine",0.065],[392,0.14,0.45,"sine",0.065]]:[[392,0,0.65,"sine",0.055],[587.33,0.02,0.62,"sine",0.045],[987.77,0.04,0.58,"sine",0.03]]):(type==="wait"?[[440,0,0.14,"sine",0.06],[659.25,0.13,0.24,"sine",0.065]]:[[523.25,0,0.14,"sine",0.055],[659.25,0.08,0.16,"sine",0.055],[783.99,0.16,0.2,"sine",0.06],[1046.5,0.24,0.34,"sine",0.05]]);for(let[freq,start,dur,wave,peak]of notes){let osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=wave||"sine";osc.frequency.setValueAtTime(freq,now+start);gain.gain.setValueAtTime(0.0008,now+start);gain.gain.exponentialRampToValueAtTime(peak||0.055,now+start+0.018);gain.gain.exponentialRampToValueAtTime(0.0001,now+start+dur);osc.connect(gain);gain.connect(ctx.destination);osc.start(now+start);osc.stop(now+start+dur+0.02)}}catch(err){}};` +
    `if(!window._agyNormUri){window._agyNormUri=u=>{try{return decodeURIComponent(String(u||"")).replace(/^file:\\/\\/\\/?/i,"").replace(/\\\\/g,"/").replace(/^\\/+([a-zA-Z]:)/,"$1").toLowerCase().split("#")[0].replace(/\\/+$/,"")}catch(err){return String(u||"").toLowerCase()}}}` +
    `if(!window._agyGetDiffStore){window._agyGetDiffStore=()=>{if(!window._agyDiffStore){try{let p=JSON.parse(window.localStorage.getItem("agy_diff_store_v2")||"{}");window._agyDiffStore={owners:p.owners&&typeof p.owners==="object"?p.owners:{},meta:p.meta&&typeof p.meta==="object"?p.meta:{},convFiles:p.convFiles&&typeof p.convFiles==="object"?p.convFiles:{},stepTs:p.stepTs&&typeof p.stepTs==="object"?p.stepTs:{}}}catch(err){window._agyDiffStore={owners:{},meta:{},convFiles:{},stepTs:{}}}}return window._agyDiffStore}}` +
    `window._agyScanConvState=(cid,st)=>{try{if(!cid||!st)return!1;let rawSteps=st?.trajectorySlice?.stepsInSlice||[];if(!rawSteps.length)return!1;let lastS=rawSteps[rawSteps.length-1],lastSub=lastS?.subtrajectory?.steps,lastSubLen=Array.isArray(lastSub)?lastSub.length:0,lastSubSt=lastSubLen>0?(lastSub[lastSubLen-1]?.metadata?.status??0):0,sig=rawSteps.length+":"+(lastS?.metadata?.status??0)+":"+lastSubLen+":"+lastSubSt+":"+(st?.status??0);if(!window._agyScanSig)window._agyScanSig=new Map();if(window._agyScanSig.get(cid)===sig)return!1;window._agyScanSig.set(cid,sig);if(window._agyScanSig.size>60){let fk=window._agyScanSig.keys().next().value;if(fk)window._agyScanSig.delete(fk)}let norm=window._agyNormUri,store=window._agyGetDiffStore(),dirty=!1,allSteps=[];for(let i=0;i<rawSteps.length;i++){let s=rawSteps[i];if(s)allSteps.push([s,String(i)]);let sub=s?.subtrajectory?.steps;if(Array.isArray(sub)){for(let j=0;j<sub.length;j++){if(sub[j])allSteps.push([sub[j],i+"_"+j])}}}for(let[s,idxKey]of allSteps){let src=s?.metadata?.source;if(src===3||src===4||src==="USER_IMPLICIT"||src==="USER_EXPLICIT")continue;let u=null,us=${wmFn ? `${wmFn}(s)` : "s"}||s;if(us?.step?.case==="codeAction"){let sv=us.step.value;if(sv?.isArtifactFile)continue;u=${qxeFn ? `${qxeFn}(sv)` : "null"}||sv?.actionSpec?.spec?.value?.path?.absoluteUri||sv?.actionSpec?.spec?.value?.target?.value?.absoluteUri}if(!u&&s?.step?.case==="generic"){let tn=String(s?.metadata?.toolCall?.name||"").toLowerCase(),baseTn=tn.includes(":")?tn.split(":").pop():tn;if(baseTn==="write_to_file"||baseTn==="replace_file_content"||baseTn==="multi_replace_file_content"||baseTn==="sed_file"||baseTn==="notebook_edit"||baseTn==="create_file"||baseTn==="edit_file"||baseTn==="delete_file"){let args=s?.step?.value?.args||{};if(args.ArtifactMetadata||args.artifactMetadata)continue;u=args.TargetFile||args.targetFile||args.path||args.file_path||args.NotebookPath;if(!u&&s?.metadata?.toolCall?.argumentsJson){try{let aj=JSON.parse(s.metadata.toolCall.argumentsJson);if(aj&&(aj.ArtifactMetadata||aj.artifactMetadata))continue;u=aj?.TargetFile||aj?.targetFile||aj?.path||aj?.file_path}catch(err){}}}}if(!u)continue;let k=norm(u);if(!k)continue;let sIdx=s?.metadata?.sourceTrajectoryStepInfo?.stepIndex??idxKey,tm=s?.metadata?.completedAt||s?.metadata?.createdAt,ts=(tm&&tm.seconds!==void 0)?(Number(tm.seconds)*1000+Math.round(Number(tm.nanos||0)/1e6)):0;if(ts<=0){let sk=cid+":"+sIdx+":"+k;if(!store.stepTs[sk]){store.stepTs[sk]=Date.now();dirty=!0}ts=store.stepTs[sk]}if(!store.convFiles[cid])store.convFiles[cid]={};if(!store.convFiles[cid][k]||ts>store.convFiles[cid][k]){store.convFiles[cid][k]=ts;dirty=!0}let curMeta=store.meta[k];if(!curMeta||ts>=curMeta.ts){if(store.owners[k]!==cid||curMeta?.ts!==ts){store.meta[k]={cid,ts};store.owners[k]=cid;dirty=!0}}}if(dirty){try{let cKeys=Object.keys(store.convFiles||{});if(cKeys.length>45){for(let oldC of cKeys.slice(0,cKeys.length-45))delete store.convFiles[oldC]}let sKeys=Object.keys(store.stepTs||{});if(sKeys.length>350){for(let oldS of sKeys.slice(0,sKeys.length-250))delete store.stepTs[oldS]}window.localStorage.setItem("agy_diff_store_v2",JSON.stringify(store))}catch(err){}}return dirty}catch(err){return!1}};` +
    `let _agySaveBotCfg=${useCbFn}(updater=>{_agySetBotCfg(prev=>{let base=_agyNormBot(prev),next=_agyNormBot(typeof updater==="function"?updater(base):updater);try{window.localStorage.setItem("agy_gravito_cfg_v2",JSON.stringify(next))}catch(err){}return next})},[]);` +
    `${useEffectFn}(()=>{if(_agyPrevWsKey.current!==_agyWsKey){_agyPrevWsKey.current=_agyWsKey;_agySetTabState(_agyNorm(window.localStorage.getItem(_agyWsKey)));_agySetEditingId(null);_agySetCtxMenu(null);_agySetShowDrop(null);_agySetShowBotTop(null);_agySetUnreadDone([]);_agySetBotAlerts([])}},[_agyWsKey]);` +
    `${useEffectFn}(()=>{if(!_agyCtxMenu&&!_agyShowDrop&&!_agyBotMenu&&!_agyShowBotTop)return;let onDown=ev=>{if(ev.target&&ev.target.closest&&(ev.target.closest(".agy-chat-ctx-menu")||ev.target.closest(".agy-chat-dropdown")||ev.target.closest(".agy-chat-drop-btn")||ev.target.closest(".agy-gravito-top-popover")||ev.target.closest(".agy-gravito-root")))return;_agySetCtxMenu(null);_agySetShowDrop(null);_agySetBotMenu(!1);_agySetShowBotTop(null)},onKey=ev=>{if(ev.key==="Escape"){_agySetCtxMenu(null);_agySetShowDrop(null);_agySetBotMenu(!1);_agySetShowBotTop(null)}};window.addEventListener("mousedown",onDown,!0);window.addEventListener("keydown",onKey,!0);return()=>{window.removeEventListener("mousedown",onDown,!0);window.removeEventListener("keydown",onKey,!0)}},[_agyCtxMenu,_agyShowDrop,_agyBotMenu,_agyShowBotTop]);` +
    `let _agySaveTabs=${useCbFn}(updater=>{_agySetTabState(prev=>{let base=_agyNorm(prev),next=_agyNorm(typeof updater==="function"?updater(base):updater);try{window.localStorage.setItem(_agyWsKey,JSON.stringify(next))}catch(err){}return next})},[_agyWsKey])` +
    `,_agyWsConvIds=${useMemoFn}(()=>{let entries=Object.entries(_agySummaries).filter(([,sum])=>!sum?.trajectoryMetadata?.parentConversationId&&!sum?.annotations?.archived);entries.sort((x,z)=>{let tx=Number(x[1]?.lastUserInputTime?.seconds??x[1]?.lastModifiedTime?.seconds??0),tz=Number(z[1]?.lastUserInputTime?.seconds??z[1]?.lastModifiedTime?.seconds??0);return tz-tx});if(_agyWsUris.length>0){let wsLower=_agyWsUris.map(w=>String(w).toLowerCase()),filtered=entries.filter(([,sum])=>{let uris=(sum?.workspaces||[]).map(w=>w.workspaceFolderAbsoluteUri).concat(sum?.trajectoryMetadata?.workspaceUris||[]).filter(Boolean).map(w=>String(w).toLowerCase());return uris.some(uri=>wsLower.includes(uri))});if(filtered.length>0)return filtered.map(([id])=>id);return[]}return entries.slice(0,8).map(([id])=>id)},[_agySummaries,_agyWsUris]);` +
    `${useEffectFn}(()=>{if(Object.keys(_agySummaries).length===0&&!${curIdVar})return;_agySaveTabs(prev=>{let openIds=[...prev.openIds],closedIds=[...prev.closedIds],changed=!1;if(${curIdVar}&&closedIds.includes(${curIdVar})){closedIds=closedIds.filter(id=>id!==${curIdVar});changed=!0}for(let cid of _agyWsConvIds.slice(0,6).reverse()){if(!openIds.includes(cid)&&!closedIds.includes(cid)){openIds.push(cid);changed=!0}}if(${curIdVar}&&!openIds.includes(${curIdVar})){openIds.push(${curIdVar});changed=!0}if(Object.keys(_agySummaries).length>0){let filteredOpen=openIds.filter(id=>Boolean(_agySummaries[id])||id===${curIdVar});if(filteredOpen.length!==openIds.length){openIds=filteredOpen;changed=!0}}return changed?{...prev,openIds,closedIds}:prev})},[_agyWsConvIds,${curIdVar},_agySummaries,_agySaveTabs]);` +
    `let _agyDisplayTabs=${useMemoFn}(()=>{let list=[...(_agyTabState.openIds||[])];for(let cid of _agyWsConvIds.slice(0,6).reverse()){if(!list.includes(cid)&&!(_agyTabState.closedIds||[]).includes(cid))list.push(cid)}if(${curIdVar}&&!list.includes(${curIdVar}))list.push(${curIdVar});if(Object.keys(_agySummaries).length>0)list=list.filter(id=>Boolean(_agySummaries[id])||id===${curIdVar});let uniq=Array.from(new Set(list)),pSet=new Set(_agyTabState.pinnedIds||[]);return[...uniq.filter(id=>pSet.has(id)),...uniq.filter(id=>!pSet.has(id))]},[_agyTabState,_agyWsConvIds,${curIdVar},_agySummaries])` +
    `,_agyTabsRef=${useRefFn}(null);` +
    `${useEffectFn}(()=>{if(!_agyGetAsp)return;if(!window._agyTabSubs)window._agyTabSubs=new Map();let subs=window._agyTabSubs,activeIds=new Set(_agyDisplayTabs);for(let tid of _agyDisplayTabs){if(!tid||tid==="_new")continue;if(!subs.has(tid)){try{let prov=_agyGetAsp(tid);if(prov){window._agyScanConvState?.(tid,prov.getState?.());let lsn=prov.onDidChange?.(st=>{let changed=window._agyScanConvState?.(tid,st);if(changed||st?.status!==void 0)_agySetLiveTick(v=>(v+1)%1000000)});subs.set(tid,{prov,lsn})}}catch(err){}}else{let entry=subs.get(tid);if(entry?.prov)window._agyScanConvState?.(tid,entry.prov.getState?.())}}for(let[tid,entry]of Array.from(subs.entries())){if(!activeIds.has(tid)){try{entry.lsn?.dispose?.();entry.prov?.dispose?.()}catch(err){}subs.delete(tid)}}},[_agyDisplayTabs,_agyGetAsp]);` +
    `${useEffectFn}(()=>{if(${curIdVar}&&_agyCurLiveState?.conversationId===${curIdVar})window._agyScanConvState?.(${curIdVar},_agyCurLiveState)},[${curIdVar},_agyCurLiveState]);` +
    `${useEffectFn}(()=>{let prevR=_agyPrevRunRef.current||{},prevW=_agyPrevWaitRef.current||{},prevM=_agyPrevModRef.current||{},newlyDone=[],newlyWait=[],startedRunning=[],stillWaiting=new Set();for(let id of _agyDisplayTabs){let s=_agySummaries[id],subSt=window._agyTabSubs?.get(id)?.prov?.getState?.();if(!s&&!subSt)continue;let liveSt=(id===${curIdVar}&&_agyCurLiveState?.conversationId===id&&_agyCurLiveState?.status!==void 0)?Number(_agyCurLiveState.status):(subSt?.conversationId===id&&subSt?.status!==void 0&&Number(subSt.status)!==0)?Number(subSt.status):Number(s?.status||0),isWait=liveSt!==1&&Boolean(s?.waitingSteps&&s.waitingSteps.length>0),isRun=(liveSt===2||liveSt===3||liveSt===4)&&!isWait,modSec=Number(s?.lastModifiedTime?.seconds||0);if(isRun)startedRunning.push(id);if(isWait){stillWaiting.add(id);if(!prevW[id])newlyWait.push(id)}if((prevR[id]&&!isRun&&!isWait)||(prevM[id]&&modSec>prevM[id]&&!isRun&&!isWait)){newlyDone.push(id)}prevR[id]=isRun;prevW[id]=isWait;if(modSec)prevM[id]=modSec}_agyPrevRunRef.current=prevR;_agyPrevWaitRef.current=prevW;_agyPrevModRef.current=prevM;let bgDone=newlyDone.filter(id=>id!==${curIdVar});if(bgDone.length>0||startedRunning.length>0){_agySetUnreadDone(prev=>{let next=prev.filter(id=>!startedRunning.includes(id));for(let id of bgDone){if(!next.includes(id))next.push(id)}return next.length===prev.length&&next.every((v,i)=>v===prev[i])?prev:next})}if(newlyDone.length>0||newlyWait.length>0||startedRunning.length>0){let store=window._agyGetDiffStore?window._agyGetDiffStore():{convFiles:{}};if(!_agyOverlayOnline){if(newlyWait.length>0&&_agyBotCfg.sound)window._agyPlayBotTone?.("wait",_agyBotCfg.soundPreset);else if(newlyDone.length>0&&_agyBotCfg.sound)window._agyPlayBotTone?.("done",_agyBotCfg.soundPreset)}_agySetBotAlerts(prev=>{let next=prev.filter(a=>!startedRunning.includes(a.tabId)&&(a.type!=="wait"||stillWaiting.has(a.tabId)));for(let id of newlyWait){let sum=_agySummaries[id],tTitle=(_agyTabState.customTitles&&_agyTabState.customTitles[id])||sum?.summary||(id===${curIdVar}?${cascadeIdVar}:_agyT.convFallback),wDetail=sum?.waitingSteps?.[0]?.step?.metadata?.toolSummary||_agyT.waitDefault;next=next.filter(a=>a.tabId!==id);next.unshift({id:"wait_"+id+"_"+Date.now(),tabId:id,type:"wait",title:tTitle,detail:wDetail,filesCount:0,autoHide:!1})}for(let id of newlyDone){let sum=_agySummaries[id],tTitle=(_agyTabState.customTitles&&_agyTabState.customTitles[id])||sum?.summary||(id===${curIdVar}?${cascadeIdVar}:_agyT.convFallback),fCount=Object.keys(store.convFiles?.[id]||{}).length;next=next.filter(a=>a.tabId!==id);next.unshift({id:"done_"+id+"_"+Date.now(),tabId:id,type:"done",title:tTitle,detail:"",filesCount:fCount,autoHide:!1})}return next.slice(0,5)})}},[_agySummaries,_agyDisplayTabs,${curIdVar},_agyCurLiveState?.status,_agyLiveTick,_agyBotCfg.sound,_agyBotCfg.soundPreset,_agyOverlayOnline,_agyTabState.customTitles]);` +
    `${useEffectFn}(()=>{if(!_agyBotAlerts.some(a=>a.autoHide))return;let tm=setTimeout(()=>{_agySetBotAlerts(prev=>prev.filter(a=>!a.autoHide))},6500);return()=>clearTimeout(tm)},[_agyBotAlerts]);` +
    `${useEffectFn}(()=>{if(${curIdVar}){_agySetUnreadDone(prev=>prev.includes(${curIdVar})?prev.filter(id=>id!==${curIdVar}):prev);_agySetBotAlerts(prev=>prev.some(a=>a.tabId===${curIdVar}&&a.type==="done"&&!a.autoHide)?prev.filter(a=>!(a.tabId===${curIdVar}&&a.type==="done"&&!a.autoHide)):prev)}},[${curIdVar}]);` +
    `${useEffectFn}(()=>{if(!_agyTabsRef.current)return;let targetId=${curIdVar}||"__new__",el=_agyTabsRef.current.querySelector(\`[data-agy-tab="\${targetId}"]\`);if(el&&typeof el.scrollIntoView==="function")el.scrollIntoView({behavior:"smooth",block:"nearest",inline:"nearest"})},[${curIdVar},_agyDisplayTabs.length]);` +
    `let _agyCloseTab=${useCbFn}((ev,tabId)=>{if(ev){ev.stopPropagation();ev.preventDefault()}let idx=_agyDisplayTabs.indexOf(tabId),remaining=_agyDisplayTabs.filter(id=>id!==tabId);_agySaveTabs(prev=>({...prev,openIds:remaining,pinnedIds:(prev.pinnedIds||[]).filter(id=>id!==tabId),closedIds:prev.closedIds.includes(tabId)?prev.closedIds:[...prev.closedIds,tabId]}));if(${curIdVar}===tabId){let nextId=remaining[idx]??remaining[idx-1];if(nextId)${setCascadeVar}(nextId);else ${startNewVar}()}},[_agyDisplayTabs,_agySaveTabs,${curIdVar},${setCascadeVar},${startNewVar}])` +
    `,_agyTogglePin=${useCbFn}(tabId=>{_agySaveTabs(prev=>{let pinned=prev.pinnedIds||[],isP=pinned.includes(tabId);return{...prev,pinnedIds:isP?pinned.filter(id=>id!==tabId):[...pinned,tabId]}});_agySetCtxMenu(null)},[_agySaveTabs])` +
    `,_agyCloseOthers=${useCbFn}(keepId=>{let pinned=_agyTabState.pinnedIds||[],remaining=_agyDisplayTabs.filter(id=>id===keepId||pinned.includes(id)),toClose=_agyDisplayTabs.filter(id=>!remaining.includes(id));_agySaveTabs(prev=>({...prev,openIds:remaining,closedIds:Array.from(new Set([...prev.closedIds,...toClose]))}));if(!remaining.includes(${curIdVar}))${setCascadeVar}(keepId);_agySetCtxMenu(null)},[_agyDisplayTabs,_agyTabState,_agySaveTabs,${curIdVar},${setCascadeVar}])` +
    `,_agyCloseRight=${useCbFn}(refId=>{let idx=_agyDisplayTabs.indexOf(refId);if(idx===-1)return;let pinned=_agyTabState.pinnedIds||[],remaining=_agyDisplayTabs.filter((id,i)=>i<=idx||pinned.includes(id)),toClose=_agyDisplayTabs.filter(id=>!remaining.includes(id));_agySaveTabs(prev=>({...prev,openIds:remaining,closedIds:Array.from(new Set([...prev.closedIds,...toClose]))}));if(!remaining.includes(${curIdVar}))${setCascadeVar}(refId);_agySetCtxMenu(null)},[_agyDisplayTabs,_agyTabState,_agySaveTabs,${curIdVar},${setCascadeVar}])` +
    `,_agyReopenLast=${useCbFn}(()=>{let closed=_agyTabState.closedIds||[];if(!closed.length)return;let lastId=closed[closed.length-1];_agySaveTabs(prev=>({...prev,openIds:[...prev.openIds.filter(id=>id!==lastId),lastId],closedIds:prev.closedIds.slice(0,-1)}));${backToConvExpr};${setCascadeVar}(lastId);_agySetCtxMenu(null)},[_agyTabState,_agySaveTabs,${setCascadeVar}])` +
    `,_agyStartRename=${useCbFn}((tabId,fallbackTitle)=>{_agySetEditingId(tabId);_agySetEditVal((_agyTabState.customTitles&&_agyTabState.customTitles[tabId])||fallbackTitle||"");_agySetCtxMenu(null)},[_agyTabState])` +
    `,_agyCommitRename=${useCbFn}((tabId,val)=>{let trimmed=String(val||"").trim();_agySaveTabs(prev=>{let nextTitles={...(prev.customTitles||{})};if(trimmed)nextTitles[tabId]=trimmed;else delete nextTitles[tabId];return{...prev,customTitles:nextTitles}});_agySetEditingId(null)},[_agySaveTabs])` +
    `,_agyReorderTabs=${useCbFn}((fromId,toId)=>{if(!fromId||!toId||fromId===toId)return;_agySaveTabs(prev=>{let list=[..._agyDisplayTabs],fromIdx=list.indexOf(fromId),toIdx=list.indexOf(toId);if(fromIdx===-1||toIdx===-1)return prev;list.splice(fromIdx,1);list.splice(toIdx,0,fromId);let pinned=(prev.pinnedIds||[]).filter(id=>list.includes(id));if(pinned.includes(fromId)&&pinned.includes(toId)){pinned=list.filter(id=>pinned.includes(id))}return{...prev,openIds:list,pinnedIds:pinned}})},[_agyDisplayTabs,_agySaveTabs])` +
    `,_agyTabMetaList=_agyDisplayTabs.map(tabId=>{let sum=_agySummaries[tabId],subSt=window._agyTabSubs?.get(tabId)?.prov?.getState?.(),rawTitle=sum?.summary||(tabId===${curIdVar}?${cascadeIdVar}:_agyT.convFallback),customTitle=_agyTabState.customTitles&&_agyTabState.customTitles[tabId],title=customTitle||rawTitle,isPinned=(_agyTabState.pinnedIds||[]).includes(tabId),isEditing=_agyEditingId===tabId,isActive=${activeTabVar}==="conversation"&&${curIdVar}===tabId,st=(tabId===${curIdVar}&&_agyCurLiveState?.conversationId===tabId&&_agyCurLiveState?.status!==void 0)?Number(_agyCurLiveState.status):(subSt?.conversationId===tabId&&subSt?.status!==void 0&&Number(subSt.status)!==0)?Number(subSt.status):Number(sum?.status||0),isWaiting=st!==1&&Boolean(sum?.waitingSteps&&sum.waitingSteps.length>0),isRunning=(st===2||st===3||st===4)&&!isWaiting,isDoneUnread=!isRunning&&!isWaiting&&!isActive&&(_agyUnreadDone.includes(tabId)||Boolean(sum?.annotations?.markedAsUnread)),waitMsg=sum?.waitingSteps?.[0]?.step?.metadata?.toolSummary||_agyT.waitDefault;return{tabId,sum,rawTitle,customTitle,title,isPinned,isEditing,isActive,isWaiting,isRunning,isDoneUnread,waitMsg}})` +
    `,_agyAnyBgWait=_agyTabMetaList.some(m=>!m.isActive&&m.isWaiting)` +
    `,_agyAnyBgRun=_agyTabMetaList.some(m=>!m.isActive&&m.isRunning)` +
    `,_agyAnyBgDone=_agyTabMetaList.some(m=>!m.isActive&&m.isDoneUnread)` +
    `,_agyRunCount=_agyTabMetaList.filter(m=>m.isRunning).length` +
    `,_agyFilteredDrop=_agyTabMetaList.filter(m=>!_agyDropQuery.trim()||String(m.title||"").toLowerCase().includes(_agyDropQuery.trim().toLowerCase()))` +
    `,_agyBotMood=_agyBotAlerts.some(a=>a.type==="wait")||_agyAnyBgWait?"wait":_agyBotAlerts.some(a=>a.type==="done")||_agyAnyBgDone?"done":_agyRunCount>0?"run":"idle"` +
    `,_agyTriggerTestAlert=()=>{if(_agyBotCfg.sound)window._agyPlayBotTone?.("done",_agyBotCfg.soundPreset);let tid=${curIdVar}||_agyDisplayTabs[0]||"test",tName=_agyTabMetaList.find(m=>m.tabId===tid)?.title||_agyT.botTestTask;_agySetBotAlerts(p=>[{id:"test_"+Date.now(),tabId:tid,type:"done",title:tName,detail:"",filesCount:2,autoHide:!0},...p].slice(0,4))};` +
    `window._agyOnOverlayAction=act=>{if(!act)return;if(act.type==="jump"){window._agyRestoreAndFocusIde?.();if(act.tabId&&act.tabId!=="test"){${backToConvExpr};${setCascadeVar}(act.tabId);_agySetUnreadDone(p=>p.filter(x=>x!==act.tabId))}_agySetBotAlerts(p=>p.filter(x=>x.id!==act.alertId&&x.tabId!==act.tabId))}else if(act.type==="togglePin"){if(act.tabId)_agyTogglePin(act.tabId)}else if(act.type==="closeTab"){if(act.tabId)_agyCloseTab(null,act.tabId)}else if(act.type==="focusIde"){window._agyRestoreAndFocusIde?.()}else if(act.type==="dismiss"){_agySetBotAlerts(p=>{let target=p.find(x=>x.id===act.alertId);if(target?.tabId||act.tabId){let tid=target?.tabId||act.tabId;_agySetUnreadDone(u=>u.filter(x=>x!==tid))}return p.filter(x=>x.id!==act.alertId)})}else if(act.type==="setSkin"){_agySaveBotCfg(p=>({...p,skin:act.skin}))}else if(act.type==="setSound"){_agySaveBotCfg(p=>({...p,sound:act.sound}))}else if(act.type==="setSoundPreset"){_agySaveBotCfg(p=>({...p,soundPreset:act.preset,sound:!0}))}else if(act.type==="setActive"){_agySaveBotCfg(p=>({...p,hidden:!act.active}))}else if(act.type==="testAlert"){_agyTriggerTestAlert()}};` +
    `${useEffectFn}(()=>{let pushState=async(extra={})=>{if(_agyBotCfg.hidden&&!_agyOverlayOnline&&!extra.resetPos){if(window._agyGravitoSSE){try{window._agyGravitoSSE.close()}catch(e){}window._agyGravitoSSE=null}return}try{let r=await window.fetch("http://127.0.0.1:${OVERLAY_PORT}/state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({active:!_agyBotCfg.hidden,desktopMode:!0,skin:_agyBotCfg.skin,sound:_agyBotCfg.sound,soundPreset:_agyBotCfg.soundPreset,mood:_agyBotMood,runCount:_agyRunCount,runningTabIds:_agyTabMetaList.filter(m=>m.isRunning).map(m=>m.tabId),tabs:_agyTabMetaList.map(m=>({tabId:m.tabId,title:m.title,isActive:m.isActive,isPinned:m.isPinned,status:m.isWaiting?"wait":m.isRunning?"run":m.isDoneUnread?"done":"idle"})),alerts:_agyBotAlerts,lang:_agyT.lang,...extra})});if(r.ok){if(_agyBotCfg.hidden){if(window._agyGravitoSSE){try{window._agyGravitoSSE.close()}catch(e){}window._agyGravitoSSE=null}_agySetOverlayOnline(!1);return}_agySetOverlayOnline(!0);let d=await r.json();if(Array.isArray(d?.actions)){for(let a of d.actions)window._agyOnOverlayAction?.(a)}if(!window._agyGravitoSSE||window._agyGravitoSSE.readyState===2){try{let es=new window.EventSource("http://127.0.0.1:${OVERLAY_PORT}/events");es.onmessage=ev=>{try{let a=JSON.parse(ev.data);if(a&&a.type!=="connected")window._agyOnOverlayAction?.(a)}catch(e){}};es.onerror=()=>{try{es.close()}catch(e){}window._agyGravitoSSE=null};window._agyGravitoSSE=es}catch(e){}}}}catch(err){_agySetOverlayOnline(!1);if(!_agyBotCfg.hidden){let now=Date.now();if(!window._agyLastSpawnReq||now-window._agyLastSpawnReq>4500){window._agyLastSpawnReq=now;try{_agyServices?._commandService?.executeCommand?.("antigravityChatTabs.ensureGravitoOverlay")}catch(e){}}}}};window._agyPushOverlayState=pushState;pushState();if(_agyBotCfg.hidden)return;let iv=setInterval(()=>pushState(),2500);return()=>clearInterval(iv)},[_agyBotCfg.hidden,_agyBotCfg.skin,_agyBotCfg.sound,_agyBotCfg.soundPreset,_agyBotMood,_agyRunCount,_agyBotAlerts,_agyDisplayTabs,${curIdVar},_agyTabState,_agyUnreadDone,_agyOverlayOnline]);` +
    `let _agyOrbPalette=_agyBotMood==="wait"?{c1:"#fde68a",c2:"#f59e0b",c3:"#b45309"}:_agyBotMood==="done"?{c1:"#a7f3d0",c2:"#10b981",c3:"#065f46"}:_agyBotMood==="run"?{c1:"#e0f2fe",c2:"#38bdf8",c3:"#1d4ed8"}:_agyBotCfg.skin==="aurora"?{c1:"#a5f3fc",c2:"#06b6d4",c3:"#0f766e"}:_agyBotCfg.skin==="solaris"?{c1:"#fbcfe8",c2:"#ec4899",c3:"#7e22ce"}:{c1:"#e0e7ff",c2:"#818cf8",c3:"#3730a3"};` +
    `return ${jsxFn}("div",{className:"${PATCH_MARKER} ${PATCH_VERSION}",children:[` +
    `${jsxFn}("style",{children:\`` +
    `@keyframes agySpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }` +
    `@keyframes agyPulseWait { 0%, 100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.75); } 50% { transform: scale(1.2); opacity: 0.9; box-shadow: 0 0 0 5px rgba(245, 158, 11, 0); } }` +
    `@keyframes agyPopIn { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }` +
    `.agy-chat-tabs-bar { position: relative; display: flex; align-items: stretch; justify-content: space-between; width: 100%; min-height: 34px; background: rgba(0, 0, 0, 0.18); border-bottom: 1px solid rgba(128, 128, 128, 0.22); user-select: none; box-sizing: border-box; }` +
    `.agy-chat-tabs-strip { display: flex; align-items: stretch; flex: 1 1 0%; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; scroll-behavior: smooth; }` +
    `.agy-chat-tabs-strip:hover { scrollbar-width: thin; }` +
    `.agy-chat-tabs-strip::-webkit-scrollbar { height: 3px; }` +
    `.agy-chat-tabs-strip::-webkit-scrollbar-track { background: transparent; }` +
    `.agy-chat-tabs-strip::-webkit-scrollbar-thumb { background: transparent; border-radius: 9999px; }` +
    `.agy-chat-tabs-strip:hover::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.45); }` +
    `.agy-chat-tabs-strip::-webkit-scrollbar-thumb:hover { background: rgba(96, 165, 250, 0.85); }` +
    `.agy-chat-tab { position: relative; display: flex; align-items: center; gap: 5px; padding: 0 8px; flex: 0 1 auto; max-width: 175px; min-width: 38px; cursor: pointer; font-size: 12px; color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground)); opacity: 0.68; border-right: 1px solid rgba(128, 128, 128, 0.18); background: transparent; transition: opacity 0.14s ease, background-color 0.14s ease, border-color 0.14s ease; box-sizing: border-box; overflow: hidden; }` +
    `.agy-chat-tab:hover { opacity: 0.96; background: rgba(255, 255, 255, 0.04); }` +
    `.agy-chat-tab.active { opacity: 1; font-weight: 500; flex: 0 0 auto; max-width: 205px; padding: 0 9px; color: var(--vscode-tab-activeForeground, var(--vscode-foreground)); background: var(--vscode-tab-activeBackground, rgba(255, 255, 255, 0.08)); }` +
    `.agy-chat-tab.active::after { content: ""; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--vscode-focusBorder, #3b82f6); }` +
    `.agy-chat-tab.is-running:not(.active) { opacity: 0.92; background: rgba(56, 189, 248, 0.06); }` +
    `.agy-chat-tab.waiting-attention:not(.active) { opacity: 1; background: rgba(245, 158, 11, 0.12); }` +
    `.agy-chat-tab.waiting-attention:not(.active)::after { content: ""; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: #f59e0b; }` +
    `.agy-chat-tab.done-unread:not(.active) { opacity: 0.95; background: rgba(16, 185, 129, 0.09); }` +
    `.agy-chat-tab.done-unread:not(.active)::after { content: ""; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: #10b981; }` +
    `.agy-chat-tab.editing { opacity: 1 !important; flex: 0 0 auto !important; min-width: 120px !important; background: rgba(59, 130, 246, 0.10) !important; }` +
    `.agy-chat-tab.editing::after { content: ""; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: #60a5fa !important; }` +
    `.agy-chat-tab.pinned { flex: 0 0 auto; min-width: 38px; max-width: 125px; padding: 0 7px; background: rgba(59, 130, 246, 0.04); }` +
    `.agy-chat-tab.dragging { opacity: 0.35; }` +
    `.agy-chat-tab.drag-over { border-left: 2px solid var(--vscode-focusBorder, #3b82f6); background: rgba(59, 130, 246, 0.10); }` +
    `.agy-chat-tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; }` +
    `.agy-status-thinking { width: 10px; height: 10px; border-radius: 9999px; border: 1.8px solid rgba(56, 189, 248, 0.28); border-top-color: #38bdf8; flex-shrink: 0; animation: agySpin 0.75s linear infinite; box-sizing: border-box; }` +
    `.agy-status-waiting { width: 8px; height: 8px; border-radius: 9999px; background: #f59e0b; flex-shrink: 0; animation: agyPulseWait 1.25s infinite ease-in-out; }` +
    `.agy-status-done { display: flex; align-items: center; justify-content: center; width: 12px; height: 12px; border-radius: 9999px; background: rgba(16, 185, 129, 0.22); color: #34d399; font-size: 9px; font-weight: 700; flex-shrink: 0; animation: agyPopIn 0.2s ease-out; }` +
    `.agy-chat-tab-pin { display: flex; align-items: center; justify-content: center; font-size: 10px; opacity: 0.75; flex-shrink: 0; color: var(--vscode-focusBorder, #60a5fa); }` +
    `.agy-chat-tab-close { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; margin-left: 1px; opacity: 0.38; transition: opacity 0.12s ease, background-color 0.12s ease; }` +
    `.agy-chat-tab:hover .agy-chat-tab-close, .agy-chat-tab.active .agy-chat-tab-close { opacity: 0.8; }` +
    `.agy-chat-tab-close:hover { opacity: 1 !important; background: rgba(255, 255, 255, 0.16); }` +
    `input.agy-chat-tab-input { flex: 1 1 0%; width: 100%; min-width: 40px; background: transparent !important; background-color: transparent !important; color: inherit !important; border: none !important; outline: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; font-family: inherit !important; font-size: 12px !important; font-weight: inherit !important; line-height: 1.2 !important; height: auto !important; caret-color: #60a5fa !important; -webkit-appearance: none !important; appearance: none !important; }` +
    `input.agy-chat-tab-input::selection { background: rgba(96, 165, 250, 0.28) !important; color: inherit !important; }` +
    `.agy-chat-tabs-actions { display: flex; align-items: center; gap: 6px; padding: 0 6px; flex-shrink: 0; border-left: 1px solid rgba(128, 128, 128, 0.18); }` +
    `.agy-chat-drop-btn { position: relative; display: flex; align-items: center; justify-content: center; gap: 4px; height: 22px; padding: 0 6px; border-radius: 4px; cursor: pointer; font-size: 11px; color: var(--vscode-foreground); opacity: 0.82; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(128, 128, 128, 0.22); transition: opacity 0.12s ease, background-color 0.12s ease, border-color 0.12s ease; }` +
    `.agy-chat-drop-btn:hover, .agy-chat-drop-btn.open { opacity: 1; background: rgba(59, 130, 246, 0.18); border-color: rgba(96, 165, 250, 0.45); }` +
    `.agy-gravito-top-popover { position: fixed; z-index: 99999; width: 242px; display: flex; flex-direction: column; gap: 7px; padding: 8px; border-radius: 14px; background: linear-gradient(160deg, rgba(17, 24, 39, 0.97) 0%, rgba(8, 12, 22, 0.99) 100%); color: #f1f5f9; border: 1px solid rgba(129, 140, 248, 0.38); box-shadow: 0 14px 32px rgba(0, 0, 0, 0.72), 0 0 20px rgba(99, 102, 241, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.12); font-size: 11px; }` +
    `.agy-gravito-top-track { display: flex; gap: 4px; padding: 3.5px; border-radius: 11px; background: rgba(2, 6, 18, 0.68); border: 1px solid rgba(255, 255, 255, 0.06); box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.5); }` +
    `.agy-gravito-top-pill { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 6px 5px; border-radius: 8px; text-align: center; cursor: pointer; font-size: 11px; font-weight: 500; color: #94a3b8; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); transition: all 0.15s ease; white-space: nowrap; }` +
    `.agy-gravito-top-pill:hover { color: #f8fafc; background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.18); }` +
    `.agy-gravito-top-pill.active { background: linear-gradient(135deg, rgba(99, 102, 241, 0.34), rgba(168, 85, 247, 0.22)); border-color: rgba(129, 140, 248, 0.7); color: #ffffff; font-weight: 600; box-shadow: 0 2px 10px rgba(99, 102, 241, 0.25); }` +
    `.agy-chat-dropdown { position: fixed; z-index: 99999; width: 265px; max-height: 340px; display: flex; flex-direction: column; padding: 6px; border-radius: 7px; background: var(--vscode-menu-background, #1e1e2e); color: var(--vscode-menu-foreground, #e2e8f0); border: 1px solid var(--vscode-menu-border, rgba(128, 128, 128, 0.28)); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5); font-size: 12px; }` +
    `.agy-chat-drop-search { width: 100%; box-sizing: border-box; padding: 5px 8px; margin-bottom: 5px; border-radius: 4px; font-size: 11.5px; background: rgba(0, 0, 0, 0.25) !important; color: inherit !important; border: 1px solid rgba(128, 128, 128, 0.28) !important; outline: none !important; }` +
    `.agy-chat-drop-search:focus { border-color: var(--vscode-focusBorder, #3b82f6) !important; }` +
    `.agy-chat-drop-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; max-height: 280px; scrollbar-width: thin; }` +
    `.agy-chat-drop-item { display: flex; align-items: center; gap: 7px; padding: 5px 8px; border-radius: 4px; cursor: pointer; transition: background-color 0.1s ease; }` +
    `.agy-chat-drop-item:hover { background: var(--vscode-menu-selectionBackground, rgba(59, 130, 246, 0.24)); color: var(--vscode-menu-selectionForeground, #ffffff); }` +
    `.agy-chat-drop-item.active { background: rgba(59, 130, 246, 0.16); font-weight: 500; border-left: 2px solid var(--vscode-focusBorder, #3b82f6); }` +
    `.agy-chat-drop-act { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 3px; opacity: 0.55; flex-shrink: 0; }` +
    `.agy-chat-drop-act:hover { opacity: 1; background: rgba(255, 255, 255, 0.15); }` +
    `.agy-chat-ctx-menu { position: fixed; z-index: 99999; min-width: 185px; padding: 4px; border-radius: 6px; background: var(--vscode-menu-background, #1e1e2e); color: var(--vscode-menu-foreground, #e2e8f0); border: 1px solid var(--vscode-menu-border, rgba(128, 128, 128, 0.28)); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); font-size: 12px; }` +
    `.agy-chat-ctx-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }` +
    `.agy-chat-ctx-item:hover { background: var(--vscode-menu-selectionBackground, rgba(59, 130, 246, 0.28)); color: var(--vscode-menu-selectionForeground, #ffffff); }` +
    `.agy-chat-ctx-sep { height: 1px; margin: 4px 6px; background: var(--vscode-menu-separatorBackground, rgba(128, 128, 128, 0.22)); }` +
    `\`}),` +
    `${activeTabVar}!=="conversation"?${jsxFn}("div",{className:"flex items-center px-2 py-1",children:${backBtnJsx}}):` +
    `${jsxFn}("div",{ref:_agyTabsRef,onWheel:ev=>{if(_agyTabsRef.current&&(ev.deltaY!==0||ev.deltaX!==0))_agyTabsRef.current.scrollLeft+=(ev.deltaY!==0?ev.deltaY:ev.deltaX)},className:"agy-chat-tabs-strip",children:[` +
    `${parentIdVar}&&${jsxFn}("div",{onClick:()=>{${setCascadeVar}(${parentIdVar})},title:\`\${_agyT.backParent}: \${${parentTitleVar}}\`,className:"agy-chat-tab",style:{minWidth:"auto",flex:"0 0 auto"},children:[${jsxFn}(${iconComp},{name:"arrow_back",size:13}),${jsxFn}("span",{className:"truncate",style:{maxWidth:"80px"},children:${parentTitleVar}})]}),` +
    `..._agyTabMetaList.map(m=>{let{tabId,rawTitle,customTitle,title,isPinned,isEditing,isActive,isWaiting,isRunning,isDoneUnread,waitMsg}=m;return ${jsxFn}("div",{"data-agy-tab":tabId,draggable:!isEditing,onDragStart:ev=>{_agySetDragId(tabId);try{ev.dataTransfer.effectAllowed="move";ev.dataTransfer.setData("text/plain",tabId)}catch(e){}},onDragOver:ev=>{ev.preventDefault();if(_agyDragId&&_agyDragId!==tabId&&_agyDragOverId!==tabId)_agySetDragOverId(tabId)},onDragLeave:()=>{if(_agyDragOverId===tabId)_agySetDragOverId(null)},onDrop:ev=>{ev.preventDefault();ev.stopPropagation();if(_agyDragId&&_agyDragId!==tabId)_agyReorderTabs(_agyDragId,tabId);_agySetDragId(null);_agySetDragOverId(null)},onDragEnd:()=>{_agySetDragId(null);_agySetDragOverId(null)},onClick:()=>{if(!isEditing){_agySetUnreadDone(prev=>prev.filter(id=>id!==tabId));${backToConvExpr};${setCascadeVar}(tabId)}},onDoubleClick:ev=>{ev.stopPropagation();_agyStartRename(tabId,rawTitle)},onContextMenu:ev=>{ev.preventDefault();ev.stopPropagation();_agySetShowDrop(null);_agySetShowBotTop(null);_agySetCtxMenu({x:Math.min(ev.clientX,window.innerWidth-210),y:Math.min(ev.clientY,window.innerHeight-230),tabId,rawTitle,isPinned,hasCustom:Boolean(customTitle)})},onAuxClick:ev=>{if(ev.button===1&&!isPinned)_agyCloseTab(ev,tabId)},title:isWaiting?\`⚠️ \${title} — \${waitMsg}\`:isRunning?\`🔄 \${title} — \${_agyT.thinkingTip}\`:isDoneUnread?\`✅ \${title} — \${_agyT.doneShort}\`:isPinned?\`📌 \${title} \${_agyT.tabHint}\`:\`\${title} \${_agyT.tabHint}\`,className:"agy-chat-tab"+(isActive?" active":"")+(isEditing?" editing":"")+(isPinned?" pinned":"")+(isRunning?" is-running":"")+(isWaiting?" waiting-attention":"")+(isDoneUnread?" done-unread":"")+(_agyDragId===tabId?" dragging":"")+(_agyDragOverId===tabId?" drag-over":""),style:isEditing?void 0:{minWidth:Math.min(72,Math.max(38,String(title||"").length*6+26))+"px"},children:[isPinned?${jsxFn}("span",{className:"agy-chat-tab-pin",onClick:ev=>{ev.stopPropagation();_agyTogglePin(tabId)},title:_agyT.unpinTip,children:"📌"}):null,isWaiting?${jsxFn}("span",{className:"agy-status-waiting",title:\`⚠️ \${waitMsg}\`}):isRunning?${jsxFn}("span",{className:"agy-status-thinking",title:\`🔄 \${_agyT.thinkingTip}\`}):isDoneUnread?${jsxFn}("span",{className:"agy-status-done",title:\`✅ \${_agyT.doneTip}\`,children:"✓"}):null,isEditing?${jsxFn}("input",{type:"text",spellCheck:!1,ref:el=>{if(el&&!el.dataset.agyInit){el.dataset.agyInit="1";el.focus();try{let l=el.value.length;el.setSelectionRange(l,l)}catch(e){}setTimeout(()=>{try{el.focus();let l=el.value.length;el.setSelectionRange(l,l)}catch(e){}},15)}},className:"agy-chat-tab-input",style:{background:"transparent",backgroundColor:"transparent",color:"inherit",border:"none",outline:"none",boxShadow:"none",padding:0,margin:0,width:"100%",minWidth:"40px",fontSize:"12px",fontFamily:"inherit",fontWeight:"inherit",lineHeight:"inherit",height:"auto",caretColor:"#60a5fa"},value:_agyEditVal,onClick:ev=>ev.stopPropagation(),onDoubleClick:ev=>ev.stopPropagation(),onMouseDown:ev=>ev.stopPropagation(),onChange:ev=>_agySetEditVal(ev.target.value),onBlur:()=>_agyCommitRename(tabId,_agyEditVal),onKeyDown:ev=>{ev.stopPropagation();if(ev.key==="Enter")_agyCommitRename(tabId,_agyEditVal);else if(ev.key==="Escape")_agySetEditingId(null)}}):${jsxFn}("span",{className:"agy-chat-tab-label",children:title}),!isPinned&&!isEditing?${jsxFn}("span",{onClick:ev=>_agyCloseTab(ev,tabId),title:_agyT.closeTip,className:"agy-chat-tab-close",children:${jsxFn}(${iconComp},{name:"close",size:12})}):null]},tabId)})` +
    `]}),` +
    `_agyShowBotTop?${jsxFn}("div",{className:"agy-gravito-top-popover",style:{left:_agyShowBotTop.x+"px",top:_agyShowBotTop.y+"px"},onClick:ev=>ev.stopPropagation(),children:[` +
    `${jsxFn}("div",{className:"agy-gravito-top-track",children:[["nebula","Nebula","radial-gradient(circle at 35% 35%, #e0e7ff 0%, #818cf8 55%, #a855f7 100%)","rgba(129, 140, 248, 0.9)"],["aurora","Aurora","radial-gradient(circle at 35% 35%, #d1fae5 0%, #10b981 55%, #06b6d4 100%)","rgba(16, 185, 129, 0.9)"],["solaris","Solaris","radial-gradient(circle at 35% 35%, #fef3c7 0%, #ec4899 55%, #f59e0b 100%)","rgba(236, 72, 153, 0.9)"]].map(([sk,lbl,bg,sh])=>${jsxFn}("div",{className:"agy-gravito-top-pill"+(_agyBotCfg.skin===sk?" active":""),style:{background:_agyBotCfg.skin===sk?void 0:"transparent",borderColor:_agyBotCfg.skin===sk?void 0:"transparent"},onClick:()=>_agySaveBotCfg(p=>({...p,skin:sk,hidden:!1})),children:[${jsxFn}("span",{style:{width:"8px",height:"8px",borderRadius:"9999px",background:bg,boxShadow:"0 0 6px "+sh,flexShrink:0}}),${jsxFn}("span",{children:lbl})]},sk))}),` +
    `${jsxFn}("div",{className:"agy-gravito-top-track",children:[["cristal","Cristal"],["pulso","Pulso"],["arpa","Arpa"],["zen","Zen"]].map(([pr,lbl])=>${jsxFn}("div",{className:"agy-gravito-top-pill"+(_agyBotCfg.sound&&_agyBotCfg.soundPreset===pr?" active":""),style:{background:_agyBotCfg.sound&&_agyBotCfg.soundPreset===pr?"rgba(16,185,129,0.25)":"transparent",borderColor:_agyBotCfg.sound&&_agyBotCfg.soundPreset===pr?"rgba(52,211,153,0.6)":"transparent",padding:"5px 4px",fontSize:"10.5px"},onClick:()=>{window._agyPlayBotTone?.("done",pr);_agySaveBotCfg(p=>({...p,soundPreset:pr,sound:!0}))},children:lbl},pr)).concat([${jsxFn}("div",{className:"agy-gravito-top-pill"+(!_agyBotCfg.sound?" active":""),style:{flex:"0 0 28px",padding:"5px 2px",background:!_agyBotCfg.sound?"rgba(239,68,68,0.22)":"transparent",borderColor:!_agyBotCfg.sound?"rgba(248,113,113,0.5)":"transparent"},onClick:()=>_agySaveBotCfg(p=>({...p,sound:!p.sound})),children:"🔇"},"mute")])}),` +
    `${jsxFn}("div",{style:{display:"flex",gap:"5px"},children:[` +
    `${jsxFn}("div",{className:"agy-gravito-top-pill"+(!_agyBotCfg.hidden?" active":""),style:{borderColor:!_agyBotCfg.hidden?"rgba(16,185,129,0.5)":"rgba(148,163,184,0.18)",background:!_agyBotCfg.hidden?"rgba(16,185,129,0.16)":"rgba(255,255,255,0.04)"},onClick:()=>_agySaveBotCfg(p=>({...p,hidden:!p.hidden})),children:!_agyBotCfg.hidden?_agyT.botActiveOn:_agyT.botActiveOff}),` +
    `${jsxFn}("div",{className:"agy-gravito-top-pill",onClick:()=>{_agySaveBotCfg(p=>({...p,x:-1,y:-1,hidden:!1}));window._agyPushOverlayState?.({resetPos:!0})},children:_agyT.botResetPos})` +
    `]})]}):null,` +
    `_agyShowDrop?${jsxFn}("div",{className:"agy-chat-dropdown",style:{left:_agyShowDrop.x+"px",top:_agyShowDrop.y+"px"},children:[` +
    `${jsxFn}("input",{type:"text",spellCheck:!1,placeholder:_agyT.searchTabs,className:"agy-chat-drop-search",value:_agyDropQuery,ref:el=>{if(el&&!el.dataset.agyFocus){el.dataset.agyFocus="1";setTimeout(()=>{try{el.focus()}catch(e){}},10)}},onChange:ev=>_agySetDropQuery(ev.target.value),onKeyDown:ev=>{ev.stopPropagation();if(ev.key==="Escape")_agySetShowDrop(null);else if(ev.key==="Enter"&&_agyFilteredDrop.length>0){let first=_agyFilteredDrop[0];_agySetUnreadDone(prev=>prev.filter(id=>first.tabId!==id));${backToConvExpr};${setCascadeVar}(first.tabId);_agySetShowDrop(null)}}}),` +
    `${jsxFn}("div",{className:"agy-chat-drop-list",children:_agyFilteredDrop.length===0?[${jsxFn}("div",{style:{padding:"8px",opacity:0.55,textAlign:"center"},children:_agyT.noTabsMatch})]:_agyFilteredDrop.map(m=>${jsxFn}("div",{className:"agy-chat-drop-item"+(m.isActive?" active":""),onClick:()=>{_agySetUnreadDone(prev=>prev.filter(id=>id!==m.tabId));${backToConvExpr};${setCascadeVar}(m.tabId);_agySetShowDrop(null)},children:[m.isWaiting?${jsxFn}("span",{className:"agy-status-waiting",title:\`⚠️ \${m.waitMsg}\`}):m.isRunning?${jsxFn}("span",{className:"agy-status-thinking",title:\`🔄 \${_agyT.thinkingTip}\`}):m.isDoneUnread?${jsxFn}("span",{className:"agy-status-done",children:"✓"}):${jsxFn}("span",{style:{width:"8px",height:"8px",borderRadius:"9999px",background:m.isActive?"#3b82f6":"rgba(148,163,184,0.35)",flexShrink:0}}),${jsxFn}("span",{className:"truncate flex-1",title:m.title,children:m.title}),${jsxFn}("span",{className:"agy-chat-drop-act",style:{opacity:m.isPinned?0.95:0.4},title:m.isPinned?_agyT.unpinTip:_agyT.pinTip,onClick:ev=>{ev.stopPropagation();_agyTogglePin(m.tabId)},children:"📌"}),!m.isPinned?${jsxFn}("span",{className:"agy-chat-drop-act",title:_agyT.closeTip,onClick:ev=>{_agyCloseTab(ev,m.tabId)},children:${jsxFn}(${iconComp},{name:"close",size:12})}):null]},m.tabId))})` +
    `]}):null,` +
    `_agyCtxMenu?${jsxFn}("div",{className:"agy-chat-ctx-menu",style:{left:_agyCtxMenu.x+"px",top:_agyCtxMenu.y+"px"},children:[` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyStartRename(_agyCtxMenu.tabId,_agyCtxMenu.rawTitle),children:[${jsxFn}("span",{children:_agyT.rename}),${jsxFn}("span",{style:{opacity:0.5,fontSize:"10px"},children:_agyT.dblClick})]}),` +
    `_agyCtxMenu.hasCustom?${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>{_agyCommitRename(_agyCtxMenu.tabId,"");_agySetCtxMenu(null)},children:${jsxFn}("span",{children:_agyT.restoreTitle})}):null,` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyTogglePin(_agyCtxMenu.tabId),children:${jsxFn}("span",{children:_agyCtxMenu.isPinned?_agyT.unpin:_agyT.pin})}),` +
    `${jsxFn}("div",{className:"agy-chat-ctx-sep"}),` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:ev=>{_agyCloseTab(ev,_agyCtxMenu.tabId);_agySetCtxMenu(null)},children:${jsxFn}("span",{children:_agyT.close})}),` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyCloseOthers(_agyCtxMenu.tabId),children:${jsxFn}("span",{children:_agyT.closeOthers})}),` +
    `${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyCloseRight(_agyCtxMenu.tabId),children:${jsxFn}("span",{children:_agyT.closeRight})}),` +
    `(_agyTabState.closedIds&&_agyTabState.closedIds.length>0)?${jsxFn}("div",{className:"agy-chat-ctx-sep"}):null,` +
    `(_agyTabState.closedIds&&_agyTabState.closedIds.length>0)?${jsxFn}("div",{className:"agy-chat-ctx-item",onClick:()=>_agyReopenLast(),children:${jsxFn}("span",{children:_agyT.reopenLast})}):null` +
    `]}):null,` +
    `${jsxFn}("div",{className:"agy-chat-tabs-actions",children:[` +
    `${jsxFn}("div",{className:"agy-chat-drop-btn"+(_agyShowBotTop?" open":""),title:_agyT.botTopTip,onClick:ev=>{ev.stopPropagation();if(_agyShowBotTop){_agySetShowBotTop(null)}else{let rect=ev.currentTarget.getBoundingClientRect();_agySetCtxMenu(null);_agySetShowDrop(null);_agySetShowBotTop({x:Math.max(8,Math.min(rect.right-272,window.innerWidth-282)),y:Math.min(rect.bottom+4,window.innerHeight-280)})}},children:[` +
    `_agyBotCfg.hidden?${jsxFn}("span",{style:{width:"6px",height:"6px",borderRadius:"9999px",background:"rgba(148,163,184,0.45)",flexShrink:0}}):_agyBotMood==="wait"?${jsxFn}("span",{className:"agy-status-waiting"}):(_agyBotMood==="run"||_agyRunCount>0)?${jsxFn}("span",{className:"agy-status-thinking"}):_agyBotMood==="done"?${jsxFn}("span",{className:"agy-status-done",children:"✓"}):null,` +
    `${jsxFn}("span",{style:{position:"relative",width:"13px",height:"13px",borderRadius:"54% 46% 60% 40% / 44% 58% 42% 56%",background:\`radial-gradient(circle at 40% 38%, rgba(255,255,255,0.95) 0%, \${_agyOrbPalette.c1} 35%, \${_agyOrbPalette.c2} 72%, transparent 100%)\`,boxShadow:_agyBotCfg.hidden?"none":\`0 0 8px \${_agyOrbPalette.c2}, 0 0 14px \${_agyOrbPalette.c2}\`,filter:"blur(0.4px)",opacity:_agyBotCfg.hidden?0.45:1,flexShrink:0}})` +
    `]}),` +
    `${activeTabVar}==="conversation"&&_agyTabMetaList.length>1?${jsxFn}("div",{className:"agy-chat-drop-btn"+(_agyShowDrop?" open":""),title:\`\${_agyT.allTabsTip} (\${_agyTabMetaList.length})\`,onClick:ev=>{ev.stopPropagation();if(_agyShowDrop){_agySetShowDrop(null)}else{let rect=ev.currentTarget.getBoundingClientRect();_agySetCtxMenu(null);_agySetShowBotTop(null);_agySetDropQuery("");_agySetShowDrop({x:Math.max(8,Math.min(rect.right-265,window.innerWidth-275)),y:Math.min(rect.bottom+4,window.innerHeight-350)})}},children:[_agyAnyBgWait?${jsxFn}("span",{className:"agy-status-waiting"}):_agyAnyBgRun?${jsxFn}("span",{className:"agy-status-thinking"}):_agyAnyBgDone?${jsxFn}("span",{className:"agy-status-done",children:"✓"}):null,${jsxFn}("span",{children:\`▾ \${_agyTabMetaList.length}\`})]}):null,` +
    `${actionsChildren}]})` +
    `]})} `;

  new vm.Script("var " + newFn.trim());

  let patched = content.slice(0, fnStart) + newFn.trim() + content.slice(fnEnd);

  const tbAnchor = patched.indexOf('"EvergreenToolbarInternal"');
  if (tbAnchor !== -1) {
    const tbStart = Math.max(0, tbAnchor - 18000);
    const tbEnd = Math.min(patched.length, tbAnchor + 500);
    let tbRegion = patched.slice(tbStart, tbEnd);
    const p1 = /\{cascadeContext:\{state:\{agentStateProvider:([A-Za-z0-9_$]+)\}\}\}=([A-Za-z0-9_$]+)\(\),([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\),([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\),\{fileDiffData:([A-Za-z0-9_$]+)\}=([A-Za-z0-9_$]+)\(\),\{enableAutoExpandToolbar:([A-Za-z0-9_$]+)\}=([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\)/;
    const m1 = p1.exec(tbRegion);
    if (m1) {
      const [full1, aspV, coF, cidV, wCF, stV, j4eF, fdV, ebuF, eatV, nlF, prefV] = m1;
      const rep1 =
        `{cascadeContext:{state:{agentStateProvider:${aspV}}}}=` +
        `${coF}(),${cidV}=${wCF}(),${stV}=${j4eF}(),` +
        `{fileDiffData:_agyRawDiffs}=${ebuF}(),_agyConvSt=${nlF}(${aspV}),` +
        `${fdV}=(()=>{try{let raw=Array.isArray(_agyRawDiffs)?_agyRawDiffs:[];if(!raw.length||!${cidV})return[];window._agyScanConvState?.(${cidV},_agyConvSt);if(window._agyTabSubs&&typeof window._agyTabSubs.entries==="function"){for(let[tid,entry]of window._agyTabSubs.entries()){if(tid&&entry?.prov)window._agyScanConvState?.(tid,entry.prov.getState?.())}}let norm=window._agyNormUri||(u=>String(u||"").toLowerCase()),store=window._agyGetDiffStore?window._agyGetDiffStore():{owners:{},convFiles:{}};return raw.filter(it=>{let k=norm(it?.uri);if(!k)return!1;let owner=store.owners?.[k];if(owner)return owner===${cidV};return Boolean(store.convFiles?.[${cidV}]?.[k])})}catch(err){return _agyRawDiffs||[]}})(),` +
        `{enableAutoExpandToolbar:${eatV}}=${nlF}(${prefV})`;
      tbRegion = tbRegion.replace(full1, rep1);

      const p2 = /\{cancelStepIndices:([A-Za-z0-9_$]+)\}=([A-Za-z0-9_$]+)\(\),([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\);return ([A-Za-z0-9_$]+)\(\(\)=>\3\.map\(/;
      tbRegion = tbRegion.replace(
        p2,
        "{cancelStepIndices:$1}=$2(),$3=$4($5,$6);return $7(()=>$3.filter(_t=>{let _st=_t?.step?.status??2;return _st===1||_st===2||_st===8||_st===9||_st===11}).map("
      );

      const p3 = /\{activePages:\{pages:([A-Za-z0-9_$]+),isLoading:([A-Za-z0-9_$]+),error:([A-Za-z0-9_$]+),refetch:([A-Za-z0-9_$]+)\}\}=([A-Za-z0-9_$]+)\(\)/;
      const m3 = p3.exec(tbRegion);
      if (m3) {
        const [full3, pgV, ldV, erV, rfV, iqoF] = m3;
        const rep3 = `{activePages:{pages:_agyRawPages,isLoading:${ldV},error:${erV},refetch:${rfV}}}=${iqoF}(),_agyCid=${wCF}(),${pgV}=(()=>{try{let list=Array.isArray(_agyRawPages)?_agyRawPages:[];if(!window._agyPageOwners){try{window._agyPageOwners=JSON.parse(window.localStorage.getItem("agy_browser_page_owners")||"{}")}catch(err){window._agyPageOwners={}}}let dirty=!1;for(let p of list){let pid=p?.pageId;if(pid&&!window._agyPageOwners[pid]&&_agyCid){window._agyPageOwners[pid]=_agyCid;dirty=!0}}if(dirty){try{window.localStorage.setItem("agy_browser_page_owners",JSON.stringify(window._agyPageOwners))}catch(err){}}if(!_agyCid)return[];return list.filter(p=>p?.pageId&&window._agyPageOwners[p.pageId]===_agyCid)}catch(err){return _agyRawPages||[]}})()`;
        tbRegion = tbRegion.replace(full3, rep3);
      }

      const p4 = /\{activePages:\{pages:([A-Za-z0-9_$]+)\}\}=([A-Za-z0-9_$]+)\(\);return\{id:"browser"/;
      const m4 = p4.exec(tbRegion);
      if (m4) {
        const [full4, pg2V, iqo2F] = m4;
        const rep4 = `{activePages:{pages:_agyRawPages2}}=${iqo2F}(),_agyCid2=${wCF}(),${pg2V}=(()=>{try{let list=Array.isArray(_agyRawPages2)?_agyRawPages2:[];if(!_agyCid2)return[];let map=window._agyPageOwners||{};return list.filter(p=>p?.pageId&&map[p.pageId]===_agyCid2)}catch(err){return _agyRawPages2||[]}})();return{id:"browser"`;
        tbRegion = tbRegion.replace(full4, rep4);
      }

      tbRegion = tbRegion.replace(
        /await ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\}\},([A-Za-z0-9_$]+)=`\$\{([A-Za-z0-9_$]+)\.length\} File/,
        "await $1($2,$3,$4,$5,Array.isArray($7)?$7.map(_x=>_x?.uri).filter(Boolean):void 0)}},$6=`${$7.length} File"
      );

      patched = patched.slice(0, tbStart) + tbRegion + patched.slice(tbEnd);
    }
  }

  const closeAnchor = patched.indexOf("async handleCloseAllDiffZones(");
  if (closeAnchor !== -1) {
    const cStart = Math.max(0, closeAnchor - 100);
    const cEnd = Math.min(patched.length, closeAnchor + 400);
    let cRegion = patched.slice(cStart, cEnd);
    cRegion = cRegion.replace(
      /async handleCloseAllDiffZones\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\{await this\._commandService\.executeCommand\("antigravity\.closeAllDiffZones",\1,\2,\3,\4\)\}/,
      'async handleCloseAllDiffZones($1,$2,$3,$4,_agyUris){try{if(Array.isArray(_agyUris)&&_agyUris.length>0&&this._cascadeService&&this._diffZoneService){let norm=window._agyNormUri||(u=>{try{return decodeURIComponent(String(u||"")).replace(/^file:\\/\\/\\/?/i,"").replace(/\\\\/g,"/").replace(/^\\/+([a-zA-Z]:)/,"$1").toLowerCase().split("#")[0].replace(/\\/+$/,"")}catch(err){return String(u||"").toLowerCase()}}),tSet=new Set(_agyUris.map(norm).filter(Boolean)),zIds=this._cascadeDiffState?.diffZoneIds||[],uMap=new Map();for(let zid of zIds){let u=this._diffZoneService.getUri(zid);if(u){let k=norm(u.toString());if(k&&!uMap.has(k))uMap.set(k,u)}}if(uMap.size>0&&tSet.size<uMap.size){let evType=$2?"accept-all-in-file":"reject-all-in-file";for(let[k,u]of uMap.entries()){if(tSet.has(k))this._cascadeService.fireEvent({type:evType,uri:u})}return}}}catch(err){}await this._commandService.executeCommand("antigravity.closeAllDiffZones",$1,$2,$3,$4)}'
    );
    patched = patched.slice(0, cStart) + cRegion + patched.slice(cEnd);
  }

  const notifAnchor = patched.indexOf("agent-finished-responding-");
  if (notifAnchor !== -1) {
    const nStart = Math.max(0, notifAnchor - 600);
    const nEnd = Math.min(patched.length, notifAnchor + 200);
    let nRegion = patched.slice(nStart, nEnd);
    nRegion = nRegion.replace(
      /(\([A-Za-z0-9_$]+=!0\)=>\{let\{stepHandler:[A-Za-z0-9_$]+,cascadeContext:\{state:\{agentStateProvider:[A-Za-z0-9_$]+\}\}\}=[A-Za-z0-9_$]+\(\),n=)([A-Za-z0-9_$]+\(\)\.core\.notificationService)/,
      "$1(window._agyGravitoActive?null:$2)"
    );
    patched = patched.slice(0, nStart) + nRegion + patched.slice(nEnd);
  }

  patched = patched.replace(
    /static _createChecksumPair\(([A-Za-z0-9_$,]+)\)\{return\{uri:([A-Za-z0-9_$]+),actual:([A-Za-z0-9_$]+),expected:([A-Za-z0-9_$]+),isPure:\3===\4\}\}/g,
    "static _createChecksumPair($1){return{uri:$2,actual:$3,expected:$4,isPure:!0}}"
  );
  return patched;
}

function pingOverlay() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${OVERLAY_PORT}/ping`, { timeout: 700 }, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function quitOverlay() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${OVERLAY_PORT}/quit`, { timeout: 600 }, () => resolve());
    req.on("error", () => resolve());
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
  });
}

async function ensureGravitoOverlay() {
  try {
    const pong = await pingOverlay();
    if (pong && pong.ok && pong.version === OVERLAY_VERSION) {
      return true;
    }
    if (pong && pong.ok) {
      await quitOverlay();
      await new Promise(r => setTimeout(r, 200));
    }
    const { overlayDest } = getIdeFiles();
    const localOverlay = path.join(__dirname, "gravito-overlay.mjs");
    const scriptPath = fs.existsSync(localOverlay) ? localOverlay : overlayDest;
    if (!fs.existsSync(scriptPath)) return false;

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env[MAIN_PATCH_MARKER] = scriptPath;
    env.AGY_GRAVITO_PORT = String(OVERLAY_PORT);
    env.AGY_PARENT_PID = String(process.pid);

    const child = spawn(process.execPath, [], {
      env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

function applyPatch() {
  const { workbenchJs, mainJs, overlayDest, productJson, wbBak, mainBak, prodBak } = getIdeFiles();
  const liveContent = fs.readFileSync(workbenchJs, "utf8");

  if (!liveContent.includes(PATCH_MARKER) || !fs.existsSync(wbBak)) {
    fs.copyFileSync(workbenchJs, wbBak);
    if (fs.existsSync(productJson)) {
      fs.copyFileSync(productJson, prodBak);
    }
  }

  const cleanContent = fs.readFileSync(wbBak, "utf8");
  const patched = buildDynamicPatch(cleanContent);
  if (typeof patched !== "string" || patched.length < cleanContent.length || !patched.includes(PATCH_VERSION)) {
    throw new Error("Safety check failed: patched bundle is invalid");
  }
  fs.writeFileSync(workbenchJs, patched, "utf8");

  if (fs.existsSync(mainJs)) {
    const liveMain = fs.readFileSync(mainJs, "utf8");
    if (!liveMain.includes(MAIN_PATCH_MARKER) || !fs.existsSync(mainBak)) {
      fs.copyFileSync(mainJs, mainBak);
    }
    const cleanMain = fs.readFileSync(mainBak, "utf8");
    const patchedMain = buildMainPatch(cleanMain);
    fs.writeFileSync(mainJs, patchedMain, "utf8");
  }

  const localOverlay = path.join(__dirname, "gravito-overlay.mjs");
  if (fs.existsSync(localOverlay)) {
    fs.copyFileSync(localOverlay, overlayDest);
  }

  if (fs.existsSync(productJson)) {
    const newHash = computeVscodeChecksum(workbenchJs);
    const prodData = JSON.parse(fs.readFileSync(productJson, "utf8"));
    if (prodData.checksums && prodData.checksums["vs/workbench/workbench.desktop.main.js"]) {
      prodData.checksums["vs/workbench/workbench.desktop.main.js"] = newHash;
      fs.writeFileSync(productJson, JSON.stringify(prodData, null, "\t"), "utf8");
    }
  }
}

function restorePatch() {
  const { workbenchJs, mainJs, productJson, wbBak, mainBak, prodBak } = getIdeFiles();
  if (fs.existsSync(wbBak)) {
    fs.copyFileSync(wbBak, workbenchJs);
  }
  if (fs.existsSync(mainBak)) {
    fs.copyFileSync(mainBak, mainJs);
  }
  if (fs.existsSync(prodBak)) {
    fs.copyFileSync(prodBak, productJson);
  }
  quitOverlay().catch(() => {});
}

function isPatchCurrent() {
  const { workbenchJs, mainJs } = getIdeFiles();
  if (!fs.existsSync(workbenchJs)) return false;
  const content = fs.readFileSync(workbenchJs, "utf8");
  const mainOk = !fs.existsSync(mainJs) || fs.readFileSync(mainJs, "utf8").includes(MAIN_PATCH_MARKER);
  return content.includes(PATCH_VERSION) && mainOk;
}

function isPatchActive() {
  const { workbenchJs } = getIdeFiles();
  if (!fs.existsSync(workbenchJs)) return false;
  const content = fs.readFileSync(workbenchJs, "utf8");
  return content.includes(PATCH_MARKER);
}

async function promptReload(message) {
  const btn = isSpanishEnv() ? "Recargar ventana" : "Reload Window";
  const action = await vscode.window.showInformationMessage(message, btn);
  if (action === btn) {
    vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

function activate(context) {
  const es = isSpanishEnv();
  context.subscriptions.push(
    vscode.commands.registerCommand("antigravityChatTabs.enable", async () => {
      try {
        applyPatch();
        await promptReload(
          es
            ? "¡Antigravity Chat Tabs activado! Recarga la ventana para aplicar los cambios."
            : "Antigravity Chat Tabs enabled! Reload the window to apply changes."
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Antigravity Chat Tabs Error: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand("antigravityChatTabs.disable", async () => {
      try {
        restorePatch();
        await promptReload(
          es
            ? "Antigravity Chat Tabs desactivado y encabezado original restaurado. Recarga la ventana."
            : "Antigravity Chat Tabs disabled and default header restored. Reload the window to apply."
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Antigravity Chat Tabs Error: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand("antigravityChatTabs.status", () => {
      const active = isPatchActive();
      vscode.window.showInformationMessage(
        es
          ? `Antigravity Chat Tabs está actualmente ${active ? "ACTIVO" : "INACTIVO"}.`
          : `Antigravity Chat Tabs is currently ${active ? "ENABLED" : "DISABLED"}.`
      );
    }),
    vscode.commands.registerCommand("antigravityChatTabs.ensureGravitoOverlay", async () => {
      return await ensureGravitoOverlay();
    })
  );

  const config = vscode.workspace.getConfiguration("antigravityChatTabs");
  if (config.get("autoApplyOnStartup", true)) {
    try {
      if (!isPatchCurrent()) {
        applyPatch();
        promptReload(
          es
            ? "Antigravity Chat Tabs: Las pestañas se actualizaron automáticamente. Recarga la ventana para activarlas."
            : "Antigravity Chat Tabs: Session tabs were automatically updated. Reload window to activate."
        );
      }
    } catch (err) {
      console.error("[Antigravity Chat Tabs] Auto-apply skipped:", err);
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate, buildDynamicPatch, buildMainPatch, applyPatch, isPatchCurrent, ensureGravitoOverlay };
