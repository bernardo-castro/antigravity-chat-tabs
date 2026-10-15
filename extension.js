const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PATCH_MARKER = "agy-chat-tabs-bar";

function getIdeFiles() {
  const appRoot = vscode.env.appRoot;
  const workbenchJs = path.join(appRoot, "out", "vs", "workbench", "workbench.desktop.main.js");
  const productJson = path.join(appRoot, "product.json");
  return {
    appRoot,
    workbenchJs,
    productJson,
    wbBak: workbenchJs + ".bak",
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

  const actionsMarker = 'className:"flex items-center gap-2 px-0.5",children:[';
  const actionsIdx = returnBody.indexOf(actionsMarker);
  if (actionsIdx === -1) {
    throw new Error("Could not find right-side actions container in header component");
  }
  const actionsChildren = returnBody.slice(actionsIdx + actionsMarker.length, -7);

  const backBtnStart = returnBody.indexOf("?") + 1;
  const backBtnEnd = returnBody.indexOf(`:${jsxFn}(`, backBtnStart);
  const backBtnJsx = returnBody.slice(backBtnStart, backBtnEnd);

  const newClickRegex = new RegExp("disabled:" + isNewVar.replace(/\$/g, "\\$") + ",onClick:\\(\\)\\=>\\{(.+?)\\},className:");
  const newClickMatch = newClickRegex.exec(returnBody);
  const newConvClickCode = newClickMatch ? newClickMatch[1] : `${startNewVar}()`;

  const newFn =
    preamble +
    `,_agyServices=${ofFn}(),_agyTs=${nlFn}(_agyServices.trajectorySummariesProvider),_agyWs=${nlFn}(_agyServices.workspaceInfoProvider)` +
    `,_agySummaries=_agyTs?.summaries||{},_agyWsUris=_agyWs?.workspaceUris||[],_agyWsKey="agy_chat_tabs_v2_"+(_agyWsUris[0]||"global")` +
    `,[_agyTabState,_agySetTabState]=${useStateFn}(()=>{try{let raw=window.localStorage.getItem(_agyWsKey);if(raw){let parsed=JSON.parse(raw);if(parsed&&Array.isArray(parsed.openIds)&&Array.isArray(parsed.closedIds))return parsed}}catch(err){}return{openIds:[],closedIds:[]}})` +
    `,_agyPrevWsKey=${useRefFn}(_agyWsKey);` +
    `${useEffectFn}(()=>{if(_agyPrevWsKey.current!==_agyWsKey){_agyPrevWsKey.current=_agyWsKey;try{let raw=window.localStorage.getItem(_agyWsKey);if(raw){let parsed=JSON.parse(raw);if(parsed&&Array.isArray(parsed.openIds)&&Array.isArray(parsed.closedIds)){_agySetTabState(parsed);return}}}catch(err){}_agySetTabState({openIds:[],closedIds:[]})}},[_agyWsKey]);` +
    `let _agySaveTabs=${useCbFn}(updater=>{_agySetTabState(prev=>{let next=typeof updater==="function"?updater(prev):updater;try{window.localStorage.setItem(_agyWsKey,JSON.stringify(next))}catch(err){}return next})},[_agyWsKey])` +
    `,_agyWsConvIds=${useMemoFn}(()=>{let entries=Object.entries(_agySummaries).filter(([,sum])=>!sum?.trajectoryMetadata?.parentConversationId&&!sum?.annotations?.archived);entries.sort((x,z)=>{let tx=Number(x[1]?.lastUserInputTime?.seconds??x[1]?.lastModifiedTime?.seconds??0),tz=Number(z[1]?.lastUserInputTime?.seconds??z[1]?.lastModifiedTime?.seconds??0);return tz-tx});if(_agyWsUris.length>0){let wsLower=_agyWsUris.map(w=>String(w).toLowerCase()),filtered=entries.filter(([,sum])=>{let uris=(sum?.workspaces||[]).map(w=>w.workspaceFolderAbsoluteUri).concat(sum?.trajectoryMetadata?.workspaceUris||[]).filter(Boolean).map(w=>String(w).toLowerCase());return uris.some(uri=>wsLower.includes(uri))});if(filtered.length>0)return filtered.map(([id])=>id);return[]}return entries.slice(0,8).map(([id])=>id)},[_agySummaries,_agyWsUris]);` +
    `${useEffectFn}(()=>{if(Object.keys(_agySummaries).length===0&&!${curIdVar})return;_agySaveTabs(prev=>{let openIds=[...prev.openIds],closedIds=[...prev.closedIds],changed=!1;if(${curIdVar}&&closedIds.includes(${curIdVar})){closedIds=closedIds.filter(id=>id!==${curIdVar});changed=!0}for(let cid of _agyWsConvIds.slice(0,6).reverse()){if(!openIds.includes(cid)&&!closedIds.includes(cid)){openIds.push(cid);changed=!0}}if(${curIdVar}&&!openIds.includes(${curIdVar})){openIds.push(${curIdVar});changed=!0}if(Object.keys(_agySummaries).length>0){let filteredOpen=openIds.filter(id=>Boolean(_agySummaries[id])||id===${curIdVar});if(filteredOpen.length!==openIds.length){openIds=filteredOpen;changed=!0}}return changed?{openIds,closedIds}:prev})},[_agyWsConvIds,${curIdVar},_agySummaries,_agySaveTabs]);` +
    `let _agyDisplayTabs=${useMemoFn}(()=>{let list=[..._agyTabState.openIds];for(let cid of _agyWsConvIds.slice(0,6).reverse()){if(!list.includes(cid)&&!_agyTabState.closedIds.includes(cid))list.push(cid)}if(${curIdVar}&&!list.includes(${curIdVar}))list.push(${curIdVar});if(Object.keys(_agySummaries).length>0)list=list.filter(id=>Boolean(_agySummaries[id])||id===${curIdVar});return Array.from(new Set(list))},[_agyTabState,_agyWsConvIds,${curIdVar},_agySummaries])` +
    `,_agyTabsRef=${useRefFn}(null);` +
    `${useEffectFn}(()=>{if(!_agyTabsRef.current)return;let targetId=${curIdVar}||"__new__",el=_agyTabsRef.current.querySelector(\`[data-agy-tab="\${targetId}"]\`);if(el&&typeof el.scrollIntoView==="function")el.scrollIntoView({behavior:"smooth",block:"nearest",inline:"nearest"})},[${curIdVar},_agyDisplayTabs.length]);` +
    `let _agyCloseTab=${useCbFn}((ev,tabId)=>{ev.stopPropagation();ev.preventDefault();let idx=_agyDisplayTabs.indexOf(tabId),remaining=_agyDisplayTabs.filter(id=>id!==tabId);_agySaveTabs(prev=>({openIds:remaining,closedIds:prev.closedIds.includes(tabId)?prev.closedIds:[...prev.closedIds,tabId]}));if(${curIdVar}===tabId){let nextId=remaining[idx]??remaining[idx-1];if(nextId)${setCascadeVar}(nextId);else ${startNewVar}()}},[_agyDisplayTabs,_agySaveTabs,${curIdVar},${setCascadeVar},${startNewVar}]);` +
    `return ${jsxFn}("div",{className:"${PATCH_MARKER}",children:[` +
    `${jsxFn}("style",{children:\`` +
    `.agy-chat-tabs-bar { display: flex; align-items: stretch; justify-content: space-between; width: 100%; min-height: 34px; background: rgba(0, 0, 0, 0.18); border-bottom: 1px solid rgba(128, 128, 128, 0.22); user-select: none; box-sizing: border-box; }` +
    `.agy-chat-tabs-strip { display: flex; align-items: stretch; flex: 1 1 0%; min-width: 0; overflow-x: auto; scrollbar-width: none; }` +
    `.agy-chat-tabs-strip::-webkit-scrollbar { display: none; }` +
    `.agy-chat-tab { position: relative; display: flex; align-items: center; gap: 6px; padding: 0 10px; max-width: 170px; min-width: 85px; flex-shrink: 0; cursor: pointer; font-size: 12px; color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground)); opacity: 0.62; border-right: 1px solid rgba(128, 128, 128, 0.18); background: transparent; transition: opacity 0.12s ease, background-color 0.12s ease; box-sizing: border-box; }` +
    `.agy-chat-tab:hover { opacity: 0.95; background: rgba(255, 255, 255, 0.04); }` +
    `.agy-chat-tab.active { opacity: 1; font-weight: 500; color: var(--vscode-tab-activeForeground, var(--vscode-foreground)); background: var(--vscode-tab-activeBackground, rgba(255, 255, 255, 0.08)); }` +
    `.agy-chat-tab.active::after { content: ""; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--vscode-focusBorder, #3b82f6); }` +
    `.agy-chat-tab.new-session { min-width: auto; padding: 0 12px; }` +
    `.agy-chat-tab-close { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0; margin-left: 2px; opacity: 0; transition: opacity 0.12s ease, background-color 0.12s ease; }` +
    `.agy-chat-tab:hover .agy-chat-tab-close { opacity: 0.65; }` +
    `.agy-chat-tab.active .agy-chat-tab-close { opacity: 0.75; }` +
    `.agy-chat-tab-close:hover { opacity: 1 !important; background: rgba(255, 255, 255, 0.16); }` +
    `.agy-chat-tabs-actions { display: flex; align-items: center; gap: 8px; padding: 0 8px; flex-shrink: 0; border-left: 1px solid rgba(128, 128, 128, 0.18); }` +
    `\`}),` +
    `${activeTabVar}!=="conversation"?${jsxFn}("div",{className:"flex items-center px-2 py-1",children:${backBtnJsx}}):` +
    `${jsxFn}("div",{ref:_agyTabsRef,onWheel:ev=>{if(_agyTabsRef.current&&ev.deltaY!==0)_agyTabsRef.current.scrollLeft+=ev.deltaY},className:"agy-chat-tabs-strip",children:[` +
    `${parentIdVar}&&${jsxFn}("div",{onClick:()=>{${setCascadeVar}(${parentIdVar})},title:\`Back to parent: \${${parentTitleVar}}\`,className:"agy-chat-tab",style:{minWidth:"auto"},children:[${jsxFn}(${iconComp},{name:"arrow_back",size:13}),${jsxFn}("span",{className:"truncate",style:{maxWidth:"80px"},children:${parentTitleVar}})]}),` +
    `..._agyDisplayTabs.map(tabId=>{let sum=_agySummaries[tabId],title=sum?.summary||(tabId===${curIdVar}?${cascadeIdVar}:"Conversation"),isActive=${activeTabVar}==="conversation"&&${curIdVar}===tabId,isRunning=Boolean(sum?.notFullyIdle),isWaiting=Boolean(sum?.waitingSteps&&sum.waitingSteps.length>0);return ${jsxFn}("div",{"data-agy-tab":tabId,onClick:()=>{${backToConvExpr},${setCascadeVar}(tabId)},onAuxClick:ev=>{if(ev.button===1)_agyCloseTab(ev,tabId)},title:title,className:"agy-chat-tab"+(isActive?" active":""),children:[isWaiting?${jsxFn}("span",{style:{width:"6px",height:"6px",borderRadius:"9999px",background:"#60a5fa",flexShrink:0}}):isRunning?${jsxFn}("span",{style:{width:"6px",height:"6px",borderRadius:"9999px",background:"#34d399",flexShrink:0}}):null,${jsxFn}("span",{className:"truncate flex-1",children:title}),${jsxFn}("span",{onClick:ev=>_agyCloseTab(ev,tabId),title:"Cerrar pestaña",className:"agy-chat-tab-close",children:${jsxFn}(${iconComp},{name:"close",size:12})})]},tabId)}),` +
    `${jsxFn}("div",{"data-agy-tab":"__new__",onClick:()=>{${backToConvExpr};if(${curIdVar}){${newConvClickCode}}},title:"Nueva conversación (Ctrl+Shift+L)",className:"agy-chat-tab new-session"+(${isNewVar}?" active":""),children:${jsxFn}("span",{className:"whitespace-nowrap",children:"New Session"})})` +
    `]}),` +
    `${jsxFn}("div",{className:"agy-chat-tabs-actions",children:[${actionsChildren}]})` +
    `]})}`;

  let patched = content.slice(0, fnStart) + newFn + content.slice(fnEnd);
  patched = patched.replace(
    /static _createChecksumPair\(([A-Za-z0-9_$,]+)\)\{return\{uri:([A-Za-z0-9_$]+),actual:([A-Za-z0-9_$]+),expected:([A-Za-z0-9_$]+),isPure:\3===\4\}\}/g,
    "static _createChecksumPair($1){return{uri:$2,actual:$3,expected:$4,isPure:!0}}"
  );
  return patched;
}

function applyPatch() {
  const { workbenchJs, productJson, wbBak, prodBak } = getIdeFiles();
  const liveContent = fs.readFileSync(workbenchJs, "utf8");

  if (!liveContent.includes(PATCH_MARKER) || !fs.existsSync(wbBak)) {
    fs.copyFileSync(workbenchJs, wbBak);
    if (fs.existsSync(productJson)) {
      fs.copyFileSync(productJson, prodBak);
    }
  }

  const cleanContent = fs.readFileSync(wbBak, "utf8");
  const patched = buildDynamicPatch(cleanContent);
  fs.writeFileSync(workbenchJs, patched, "utf8");

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
  const { workbenchJs, productJson, wbBak, prodBak } = getIdeFiles();
  if (fs.existsSync(wbBak)) {
    fs.copyFileSync(wbBak, workbenchJs);
  }
  if (fs.existsSync(prodBak)) {
    fs.copyFileSync(prodBak, productJson);
  }
}

function isPatchActive() {
  const { workbenchJs } = getIdeFiles();
  if (!fs.existsSync(workbenchJs)) return false;
  const content = fs.readFileSync(workbenchJs, "utf8");
  return content.includes(PATCH_MARKER);
}

async function promptReload(message) {
  const action = await vscode.window.showInformationMessage(message, "Reload Window");
  if (action === "Reload Window") {
    vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("antigravityChatTabs.enable", async () => {
      try {
        applyPatch();
        await promptReload("Antigravity Chat Tabs enabled! Reload the window to apply changes.");
      } catch (err) {
        vscode.window.showErrorMessage(`Antigravity Chat Tabs Error: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand("antigravityChatTabs.disable", async () => {
      try {
        restorePatch();
        await promptReload("Antigravity Chat Tabs disabled and default header restored. Reload the window to apply.");
      } catch (err) {
        vscode.window.showErrorMessage(`Antigravity Chat Tabs Error: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand("antigravityChatTabs.status", () => {
      const active = isPatchActive();
      vscode.window.showInformationMessage(
        `Antigravity Chat Tabs is currently ${active ? "ENABLED" : "DISABLED"}.`
      );
    })
  );

  // Auto-apply after Antigravity IDE updates if enabled
  const config = vscode.workspace.getConfiguration("antigravityChatTabs");
  if (config.get("autoApplyOnStartup", true)) {
    try {
      if (!isPatchActive()) {
        applyPatch();
        promptReload(
          "Antigravity Chat Tabs: Session tabs were automatically re-applied after an IDE update. Reload window to activate."
        );
      }
    } catch (err) {
      console.error("[Antigravity Chat Tabs] Auto-apply skipped:", err);
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
