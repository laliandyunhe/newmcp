/**
 * MCP 调试面板插件 v2 —— 支持多个 MCP server
 *
 * 和 mcp-hook.js 之间通过 localStorage["roche-mcp-hook:servers"] 共享配置，
 * 因为 mcp-hook.js 是注入在 index.html 里的原生脚本，不在插件沙箱里，
 * 没法用 roche.storage（那是插件私有隔离存储）。
 */

(function () {
  "use strict";

  const STORAGE_KEY = "roche-mcp-hook:servers";

  function loadServers() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveServers(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function makeId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function emptyServer() {
    return {
      id: makeId(),
      name: "",
      enabled: true,
      transport: "streamable-http",
      url: "",
      headers: [],
      toolsEnabled: null, // null = 全部启用
      _tools: [], // 仅前端展示用，不持久化到最终保存结构外的字段也没关系，反正整对象都存
    };
  }

  window.RochePlugin.register({
    id: "mcp-debug",
    name: "MCP 调试面板",
    version: "2.0.0",
    apps: [
      {
        id: "mcp-debug-home",
        name: "MCP 调试",
        icon: "settings",
        iconImage: "",

        async mount(container, roche) {
          const state = {
            view: "list", // "list" | "edit"
            servers: loadServers(),
            editing: null, // 当前编辑的 server 对象（拷贝）
            editTab: "basic", // "basic" | "tools"
            testStatus: "idle", // idle | testing | success | error
            testMessage: "",
          };

          const style = document.createElement("style");
          style.textContent = `
            .roche-plugin-mcp-debug {
              font-family: sans-serif; height: 100%; overflow-y: auto;
              background: #111214; color: #eee; padding: 12px; box-sizing: border-box;
            }
            .roche-plugin-mcp-debug * { box-sizing: border-box; }
            .rpmd-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
            .rpmd-title { font-size: 17px; font-weight: 600; }
            .rpmd-back, .rpmd-add {
              background: #2a2b2f; color: #eee; border: none; border-radius: 8px;
              padding: 6px 12px; font-size: 13px;
            }
            .rpmd-add { background: #3b6ef0; }
            .rpmd-empty { color: #666; font-size: 13px; text-align: center; padding: 40px 0; }
            .rpmd-server-item {
              background: #1b1c1f; border-radius: 12px; padding: 12px; margin-bottom: 10px;
              display: flex; align-items: center; justify-content: space-between; gap: 8px;
            }
            .rpmd-server-info { flex: 1; min-width: 0; }
            .rpmd-server-name { font-size: 14px; font-weight: 600; }
            .rpmd-server-url { font-size: 12px; color: #888; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .rpmd-server-meta { font-size: 11px; color: #666; margin-top: 2px; }
            .rpmd-dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px; }
            .rpmd-dot.on { background:#4ade80; } .rpmd-dot.off { background:#666; }

            .rpmd-tabs { display: flex; border-bottom: 1px solid #2a2b2f; margin-bottom: 16px; }
            .rpmd-tab { flex: 1; text-align: center; padding: 10px 0; font-size: 14px; color: #999; }
            .rpmd-tab.active { color: #6ea8fe; border-bottom: 2px solid #3b6ef0; font-weight: 600; }

            .rpmd-field { margin-bottom: 16px; }
            .rpmd-label { font-size: 15px; font-weight: 600; display: block; margin-bottom: 2px; }
            .rpmd-hint { font-size: 12px; color: #888; margin-bottom: 8px; display: block; }
            .rpmd-input {
              width: 100%; background: #1b1c1f; color: #eee; border: 1px solid #333;
              border-radius: 10px; padding: 12px; font-size: 14px;
            }
            .rpmd-switch { position: relative; width: 44px; height: 24px; flex-shrink: 0; display:inline-block; }
            .rpmd-switch input { opacity: 0; width: 0; height: 0; }
            .rpmd-slider { position: absolute; cursor: pointer; inset: 0; background: #444; border-radius: 24px; transition: 0.15s; }
            .rpmd-slider:before { content: ""; position: absolute; height: 18px; width: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.15s; }
            .rpmd-switch input:checked + .rpmd-slider { background: #3b6ef0; }
            .rpmd-switch input:checked + .rpmd-slider:before { transform: translateX(20px); }

            .rpmd-segment { display: flex; border: 1px solid #333; border-radius: 10px; overflow: hidden; }
            .rpmd-segment-btn { flex: 1; text-align: center; padding: 10px; font-size: 13px; background: #1b1c1f; color: #ccc; }
            .rpmd-segment-btn.active { background: #2a3a6e; color: #9ec2ff; }

            .rpmd-header-row-btn {
              width: 100%; background: #2a2b2f; color: #eee; border: none; border-radius: 10px;
              padding: 12px; font-size: 14px; text-align: center;
            }
            .rpmd-header-row { display: flex; gap: 6px; margin-bottom: 8px; align-items: center; }
            .rpmd-header-row input { flex: 1; }
            .rpmd-header-remove { background: #7a2a2a; color: #fff; border: none; border-radius: 8px; padding: 8px 10px; font-size: 12px; }

            .rpmd-btn-row { display: flex; gap: 8px; margin-top: 20px; }
            .rpmd-btn { flex: 1; border: none; border-radius: 10px; padding: 12px; font-size: 14px; }
            .rpmd-btn.primary { background: #3b6ef0; color: #fff; }
            .rpmd-btn.secondary { background: #2a2b2f; color: #eee; }
            .rpmd-btn.danger { background: #7a2a2a; color: #fff; }

            .rpmd-status { font-size: 13px; margin-top: 8px; line-height: 1.5; }
            .rpmd-status.success { color: #4ade80; }
            .rpmd-status.error { color: #f87171; }
            .rpmd-status.testing { color: #fbbf24; }

            .rpmd-tool-row { background: #1b1c1f; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
            .rpmd-tool-name { font-size: 13px; font-weight: 600; }
            .rpmd-tool-desc { font-size: 11px; color: #888; margin-top: 2px; }
          `;
          container.appendChild(style);

          const root = document.createElement("div");
          root.className = "roche-plugin-mcp-debug";
          container.appendChild(root);

          function persist() {
            saveServers(state.servers);
          }

          function openEdit(server) {
            state.editing = server ? JSON.parse(JSON.stringify(server)) : emptyServer();
            state.editTab = "basic";
            state.testStatus = "idle";
            state.testMessage = "";
            state.view = "edit";
            render();
          }

          async function rawRpc(server, method, params, sessionRef) {
            const headers = { "Content-Type": "application/json" };
            (server.headers || []).forEach((h) => { if (h.key) headers[h.key] = h.value || ""; });
            if (sessionRef.id) headers["Mcp-Session-Id"] = sessionRef.id;

            const resp = await fetch(server.url, {
              method: "POST",
              headers,
              body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() + Math.random(), method, params: params || {} }),
            });
            const sid = resp.headers.get("Mcp-Session-Id");
            if (sid) sessionRef.id = sid;
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
            return data.result;
          }

          async function testAndListTools() {
            if (!state.editing.url) {
              state.testStatus = "error";
              state.testMessage = "请先填服务器地址";
              render();
              return;
            }

            if (state.editing.transport === "sse") {
              state.testStatus = "error";
              state.testMessage = "调试面板暂时只支持直接测试 Streamable HTTP，SSE 类型请直接保存后在正式对话里验证";
              render();
              return;
            }

            state.testStatus = "testing";
            state.testMessage = "连接中...";
            render();

            const sessionRef = { id: null };
            const startedAt = Date.now();
            try {
              await rawRpc(state.editing, "initialize", {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: { name: "roche-mcp-debug-plugin", version: "2.0.0" },
              }, sessionRef);

              const list = await rawRpc(state.editing, "tools/list", {}, sessionRef);
              const latency = Date.now() - startedAt;

              state.editing._tools = (list.tools || []).map((t) => ({
                name: t.name,
                description: t.description || "",
                inputSchema: t.inputSchema || { type: "object", properties: {} },
              }));

              state.testStatus = "success";
              state.testMessage = `连接成功，延迟 ${latency}ms，发现 ${state.editing._tools.length} 个工具`;
            } catch (e) {
              state.testStatus = "error";
              state.testMessage = "连接失败：" + e.message;
            }

            render();
          }

          function isToolEnabled(toolName) {
            const f = state.editing.toolsEnabled;
            return f === null || f === undefined || f.includes(toolName);
          }

          function toggleTool(toolName, checked) {
            if (state.editing.toolsEnabled === null || state.editing.toolsEnabled === undefined) {
              state.editing.toolsEnabled = state.editing._tools.map((t) => t.name);
            }
            const set = new Set(state.editing.toolsEnabled);
            if (checked) set.add(toolName); else set.delete(toolName);
            state.editing.toolsEnabled = Array.from(set);
            render();
          }

          function saveEditing() {
            if (!state.editing.name.trim()) {
              roche.ui.toast("请填名称");
              return;
            }
            if (!state.editing.url.trim()) {
              roche.ui.toast("请填服务器地址");
              return;
            }

            const cleaned = { ...state.editing };
            delete cleaned._tools;

            const idx = state.servers.findIndex((s) => s.id === cleaned.id);
            if (idx === -1) state.servers.push(cleaned);
            else state.servers[idx] = cleaned;

            persist();
            state.view = "list";
            roche.ui.toast("已保存");
            render();
          }

          async function deleteEditing() {
            const ok = await roche.ui.confirm({
              title: "删除这个 MCP Server？",
              message: `将删除 "${state.editing.name || "未命名"}"，此操作不可撤销。`,
            });
            if (!ok) return;
            state.servers = state.servers.filter((s) => s.id !== state.editing.id);
            persist();
            state.view = "list";
            render();
          }

          function escapeHtml(str) {
            return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          }

          function renderList() {
            const header = document.createElement("div");
            header.className = "rpmd-header";
            header.innerHTML = `<div class="rpmd-title">MCP 调试面板</div>`;
            const addBtn = document.createElement("button");
            addBtn.className = "rpmd-add";
            addBtn.textContent = "+ 添加";
            addBtn.onclick = () => openEdit(null);
            header.appendChild(addBtn);
            root.appendChild(header);

            if (state.servers.length === 0) {
              const empty = document.createElement("div");
              empty.className = "rpmd-empty";
              empty.textContent = "还没有添加 MCP Server，点右上角\"+ 添加\"";
              root.appendChild(empty);
              return;
            }

            state.servers.forEach((server) => {
              const item = document.createElement("div");
              item.className = "rpmd-server-item";

              const info = document.createElement("div");
              info.className = "rpmd-server-info";
              const toolCount =
                server.toolsEnabled === null || server.toolsEnabled === undefined
                  ? "全部工具"
                  : `${server.toolsEnabled.length} 个工具已启用`;
              info.innerHTML = `
                <div class="rpmd-server-name">${escapeHtml(server.name || "未命名")}</div>
                <div class="rpmd-server-url">${escapeHtml(server.url)}</div>
                <div class="rpmd-server-meta">
                  <span class="rpmd-dot ${server.enabled ? "on" : "off"}"></span>${server.enabled ? "已启用" : "已禁用"}
                  · ${server.transport === "sse" ? "SSE" : "Streamable HTTP"} · ${toolCount}
                </div>
              `;
              info.onclick = () => openEdit(server);
              item.appendChild(info);

              const switchLabel = document.createElement("label");
              switchLabel.className = "rpmd-switch";
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = server.enabled;
              checkbox.onchange = (e) => {
                server.enabled = e.target.checked;
                persist();
                render();
              };
              const slider = document.createElement("span");
              slider.className = "rpmd-slider";
              switchLabel.appendChild(checkbox);
              switchLabel.appendChild(slider);
              item.appendChild(switchLabel);

              root.appendChild(item);
            });
          }

          function renderEdit() {
            const header = document.createElement("div");
            header.className = "rpmd-header";
            header.innerHTML = `<div class="rpmd-title">${state.editing.name ? escapeHtml(state.editing.name) : "新 MCP Server"}</div>`;
            const backBtn = document.createElement("button");
            backBtn.className = "rpmd-back";
            backBtn.textContent = "返回";
            backBtn.onclick = () => { state.view = "list"; render(); };
            header.appendChild(backBtn);
            root.appendChild(header);

            const tabs = document.createElement("div");
            tabs.className = "rpmd-tabs";
            const basicTab = document.createElement("div");
            basicTab.className = "rpmd-tab" + (state.editTab === "basic" ? " active" : "");
            basicTab.textContent = "基础设置";
            basicTab.onclick = () => { state.editTab = "basic"; render(); };
            const toolsTab = document.createElement("div");
            toolsTab.className = "rpmd-tab" + (state.editTab === "tools" ? " active" : "");
            toolsTab.textContent = "工具";
            toolsTab.onclick = () => { state.editTab = "tools"; render(); };
            tabs.appendChild(basicTab);
            tabs.appendChild(toolsTab);
            root.appendChild(tabs);

            if (state.editTab === "basic") renderBasicTab();
            else renderToolsTab();

            const btnRow = document.createElement("div");
            btnRow.className = "rpmd-btn-row";

            const isExisting = state.servers.some((s) => s.id === state.editing.id);
            if (isExisting) {
              const delBtn = document.createElement("button");
              delBtn.className = "rpmd-btn danger";
              delBtn.textContent = "删除";
              delBtn.onclick = deleteEditing;
              btnRow.appendChild(delBtn);
            }

            const saveBtn = document.createElement("button");
            saveBtn.className = "rpmd-btn primary";
            saveBtn.textContent = "保存";
            saveBtn.onclick = saveEditing;
            btnRow.appendChild(saveBtn);

            root.appendChild(btnRow);
          }

          function renderBasicTab() {
            // 启用
            const enableField = document.createElement("div");
            enableField.className = "rpmd-field";
            enableField.style.display = "flex";
            enableField.style.alignItems = "center";
            enableField.style.justifyContent = "space-between";
            enableField.innerHTML = `<div><span class="rpmd-label">启用</span><span class="rpmd-hint" style="margin-bottom:0">是否启用此 MCP 服务器</span></div>`;
            const switchLabel = document.createElement("label");
            switchLabel.className = "rpmd-switch";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = state.editing.enabled;
            checkbox.onchange = (e) => { state.editing.enabled = e.target.checked; };
            const slider = document.createElement("span");
            slider.className = "rpmd-slider";
            switchLabel.appendChild(checkbox);
            switchLabel.appendChild(slider);
            enableField.appendChild(switchLabel);
            root.appendChild(enableField);

            // 名称
            const nameField = document.createElement("div");
            nameField.className = "rpmd-field";
            nameField.innerHTML = `<span class="rpmd-label">名称</span><span class="rpmd-hint">MCP 服务器的显示名称</span>`;
            const nameInput = document.createElement("input");
            nameInput.className = "rpmd-input";
            nameInput.placeholder = "名称";
            nameInput.value = state.editing.name;
            nameInput.oninput = (e) => { state.editing.name = e.target.value; };
            nameField.appendChild(nameInput);
            root.appendChild(nameField);

            // 传输类型
            const transportField = document.createElement("div");
            transportField.className = "rpmd-field";
            transportField.innerHTML = `<span class="rpmd-label">传输类型</span><span class="rpmd-hint">选择 MCP 服务器的传输协议类型</span>`;
            const segment = document.createElement("div");
            segment.className = "rpmd-segment";
            const httpBtn = document.createElement("div");
            httpBtn.className = "rpmd-segment-btn" + (state.editing.transport === "streamable-http" ? " active" : "");
            httpBtn.textContent = (state.editing.transport === "streamable-http" ? "✓ " : "") + "Streamable HTTP";
            httpBtn.onclick = () => { state.editing.transport = "streamable-http"; render(); };
            const sseBtn = document.createElement("div");
            sseBtn.className = "rpmd-segment-btn" + (state.editing.transport === "sse" ? " active" : "");
            sseBtn.textContent = (state.editing.transport === "sse" ? "✓ " : "") + "SSE";
            sseBtn.onclick = () => { state.editing.transport = "sse"; render(); };
            segment.appendChild(httpBtn);
            segment.appendChild(sseBtn);
            transportField.appendChild(segment);
            root.appendChild(transportField);

            // 服务器地址
            const urlField = document.createElement("div");
            urlField.className = "rpmd-field";
            urlField.innerHTML = `<span class="rpmd-label">服务器地址</span><span class="rpmd-hint">${state.editing.transport === "sse" ? "SSE" : "流式 HTTP"} 服务器的 URL 地址</span>`;
            const urlInput = document.createElement("input");
            urlInput.className = "rpmd-input";
            urlInput.placeholder = "URL";
            urlInput.value = state.editing.url;
            urlInput.oninput = (e) => { state.editing.url = e.target.value; };
            urlField.appendChild(urlInput);
            root.appendChild(urlField);

            // 自定义请求头
            const headersField = document.createElement("div");
            headersField.className = "rpmd-field";
            headersField.innerHTML = `<span class="rpmd-label">自定义请求头</span><span class="rpmd-hint">为 MCP 服务器请求添加自定义 HTTP 头</span>`;

            (state.editing.headers || []).forEach((h, i) => {
              const row = document.createElement("div");
              row.className = "rpmd-header-row";

              const keyInput = document.createElement("input");
              keyInput.className = "rpmd-input";
              keyInput.placeholder = "Header 名，如 Authorization";
              keyInput.value = h.key || "";
              keyInput.oninput = (e) => { state.editing.headers[i].key = e.target.value; };

              const valInput = document.createElement("input");
              valInput.className = "rpmd-input";
              valInput.placeholder = "值";
              valInput.value = h.value || "";
              valInput.oninput = (e) => { state.editing.headers[i].value = e.target.value; };

              const removeBtn = document.createElement("button");
              removeBtn.className = "rpmd-header-remove";
              removeBtn.textContent = "删除";
              removeBtn.onclick = () => { state.editing.headers.splice(i, 1); render(); };

              row.appendChild(keyInput);
              row.appendChild(valInput);
              row.appendChild(removeBtn);
              headersField.appendChild(row);
            });

            const addHeaderBtn = document.createElement("button");
            addHeaderBtn.className = "rpmd-header-row-btn";
            addHeaderBtn.textContent = "+ 添加请求头";
            addHeaderBtn.onclick = () => {
              state.editing.headers = state.editing.headers || [];
              state.editing.headers.push({ key: "", value: "" });
              render();
            };
            headersField.appendChild(addHeaderBtn);
            root.appendChild(headersField);

            // 测试连接
            const testBtn = document.createElement("button");
            testBtn.className = "rpmd-btn secondary";
            testBtn.style.width = "100%";
            testBtn.textContent = "测试连接并拉取工具列表";
            testBtn.onclick = testAndListTools;
            root.appendChild(testBtn);

            if (state.testMessage) {
              const statusEl = document.createElement("div");
              statusEl.className = "rpmd-status " + state.testStatus;
              statusEl.textContent = state.testMessage;
              root.appendChild(statusEl);
            }
          }

          function renderToolsTab() {
            if (!state.editing._tools || state.editing._tools.length === 0) {
              const empty = document.createElement("div");
              empty.className = "rpmd-empty";
              empty.textContent = "还没有工具列表，先去\"基础设置\"里测试连接";
              root.appendChild(empty);
              return;
            }

            const bulkRow = document.createElement("div");
            bulkRow.className = "rpmd-btn-row";
            bulkRow.style.marginTop = "0";
            bulkRow.style.marginBottom = "12px";

            const enableAllBtn = document.createElement("button");
            enableAllBtn.className = "rpmd-btn secondary";
            enableAllBtn.textContent = "全部启用";
            enableAllBtn.onclick = () => { state.editing.toolsEnabled = null; render(); };

            const disableAllBtn = document.createElement("button");
            disableAllBtn.className = "rpmd-btn danger";
            disableAllBtn.textContent = "全部禁用";
            disableAllBtn.onclick = () => { state.editing.toolsEnabled = []; render(); };

            bulkRow.appendChild(enableAllBtn);
            bulkRow.appendChild(disableAllBtn);
            root.appendChild(bulkRow);

            state.editing._tools.forEach((tool) => {
              const row = document.createElement("div");
              row.className = "rpmd-tool-row";
              row.innerHTML = `
                <div>
                  <div class="rpmd-tool-name">${escapeHtml(tool.name)}</div>
                  <div class="rpmd-tool-desc">${escapeHtml(tool.description || "（无描述）")}</div>
                </div>
              `;
              const switchLabel = document.createElement("label");
              switchLabel.className = "rpmd-switch";
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = isToolEnabled(tool.name);
              checkbox.onchange = (e) => toggleTool(tool.name, e.target.checked);
              const slider = document.createElement("span");
              slider.className = "rpmd-slider";
              switchLabel.appendChild(checkbox);
              switchLabel.appendChild(slider);
              row.appendChild(switchLabel);
              root.appendChild(row);
            });
          }

          function render() {
            root.innerHTML = "";
            if (state.view === "list") renderList();
            else renderEdit();
          }

          render();

          container.__mcpDebugCleanup = () => style.remove();
        },

        async unmount(container) {
          if (container.__mcpDebugCleanup) container.__mcpDebugCleanup();
          container.replaceChildren();
        },
      },
    ],
  });
})();
