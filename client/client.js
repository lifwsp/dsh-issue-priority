/*
 * dsh-issue-priority — browser half.
 *
 * Adds an "Issue 計画" tab to dsh-better-sidebar (optional peer). The tab shows
 * the work-package plan the host keeps in the background and offers buttons for
 * sync / kickoff / defer / pin, so nobody has to remember the /issues commands.
 *
 * Rules (see dsh-better-sidebar guide and dsh-run-button):
 *  - Hand-written, no build step. Only `react` is required from the loader.
 *  - No value import of dsh-better-sidebar or @deepseek-ai/*.
 *  - Browser globals only via `window.`.
 *  - apply() must never throw: a throwing client apply replaces the whole app.
 *  - The sidebar service may arrive after this bundle → bind with a retry.
 */
window.__ModuleLoader__.load({
	id: "dsh-issue-priority",
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var h = react.createElement;

		var CHANNEL = "/dsh-issue-priority";
		var TAB_ID = "dsh-issue-priority:plan";
		var PREFIX = "dsh-issueprio";
		var POLL_MS = 60000;

		var STATUS = {
			ready: { label: "着手可", cls: "ready" },
			waiting: { label: "先行待ち", cls: "waiting" },
			blocked: { label: "ブロック中", cls: "blocked" },
			in_progress: { label: "作業中", cls: "active" },
		};

		var CSS = [
			"." + PREFIX + "{height:100%;min-height:0;display:flex;flex-direction:column;font-size:12px;color:var(--dsw-alias-text-primary,inherit);}",
			"." + PREFIX + "-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.25));}",
			"." + PREFIX + "-repo{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
			"." + PREFIX + "-meta{padding:4px 10px;opacity:.7;font-size:11px;}",
			"." + PREFIX + "-body{flex:1;min-height:0;overflow:auto;padding:6px 10px 12px;}",
			"." + PREFIX + "-btn{font:inherit;font-size:11px;padding:2px 8px;border-radius:5px;cursor:pointer;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;}",
			"." + PREFIX + "-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15));}",
			"." + PREFIX + "-btn[disabled]{opacity:.45;cursor:default;}",
			"." + PREFIX + "-btn.primary{background:var(--dsw-alias-state-business-primary,#3b82f6);border-color:transparent;color:#fff;}",
			"." + PREFIX + "-btn.on{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.3));}",
			"." + PREFIX + "-pkg{border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.25));border-radius:8px;padding:8px;margin:8px 0;}",
			"." + PREFIX + "-pkg.next{border-color:var(--dsw-alias-state-business-primary,#3b82f6);}",
			"." + PREFIX + "-pkghead{display:flex;align-items:center;gap:6px;margin-bottom:4px;}",
			"." + PREFIX + "-pkgid{font-weight:600;}",
			"." + PREFIX + "-badge{font-size:10px;padding:1px 6px;border-radius:9px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.2));}",
			"." + PREFIX + "-badge.ready{background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff;}",
			"." + PREFIX + "-badge.active{background:var(--dsw-alias-state-success-primary,#16a34a);color:#fff;}",
			"." + PREFIX + "-badge.blocked{background:var(--dsw-alias-state-warn-primary,#d97706);color:#fff;}",
			"." + PREFIX + "-spacer{flex:1;}",
			"." + PREFIX + "-issue{display:flex;align-items:flex-start;gap:4px;padding:3px 0;}",
			"." + PREFIX + "-issue a{color:inherit;text-decoration:none;flex:1;min-width:0;}",
			"." + PREFIX + "-issue a:hover{text-decoration:underline;}",
			"." + PREFIX + "-num{opacity:.65;margin-right:4px;}",
			"." + PREFIX + "-why{opacity:.7;font-size:11px;margin-top:2px;}",
			"." + PREFIX + "-section{margin-top:14px;font-weight:600;}",
			"." + PREFIX + "-err{margin:8px 0;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-state-warn-bg,rgba(217,119,6,.12));}",
			"." + PREFIX + "-ok{margin:8px 0;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.12));}",
			"." + PREFIX + "-mini{font-size:10px;padding:1px 5px;}",
		].join("\n");

		var rpc = null;

		function call(endpoint, payload) {
			if (rpc === null || typeof rpc.call !== "function") {
				return Promise.reject(new Error("ホストに接続できません（connection.rpc がありません）"));
			}
			return Promise.resolve(rpc.call(CHANNEL, endpoint, payload || {})).then(function (result) {
				if (result && result.ok === true) return result.value;
				var message = result && result.error && result.error.message ? result.error.message : "失敗しました";
				throw new Error(message);
			});
		}

		function fmtTime(iso) {
			if (!iso) return "未同期";
			var d = new Date(iso);
			if (isNaN(d.getTime())) return iso;
			var pad = function (n) { return n < 10 ? "0" + n : String(n); };
			return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
		}

		function describe(r) {
			switch (r.kind) {
				case "files-overlap": return "#" + r.issues[0] + " と #" + r.issues[1] + " が同じファイル（" + r.files.slice(0, 2).join(", ") + "）";
				case "area-match": return "#" + r.issues[0] + " と #" + r.issues[1] + " が同じ領域（" + r.areas.join(", ") + "）";
				case "decision-merge": return "#" + r.issues[0] + " と #" + r.issues[1] + " は一緒に片付けるのが自然";
				case "hard-dependency": return "#" + r.issue + " は #" + r.dependsOn + " の後";
				case "advisory-order": return "#" + r.before + " → #" + r.after + " の順が推奨";
				case "pinned": return "#" + r.issue + " は優先指定";
				case "deferred": return "#" + r.issue + " は後回し指定";
				default: return "";
			}
		}

		function openUrl(event, url) {
			// Let the host/sidebar claim links when it can; otherwise a new window.
			if (!url) return;
			event.preventDefault();
			try { window.open(url, "_blank", "noopener"); } catch (e) { /* ignore */ }
		}

		function IssueRow(props) {
			var n = props.n;
			var info = props.view.issues[String(n)];
			var ov = props.view.overrides[String(n)];
			return h("div", { className: PREFIX + "-issue" },
				h("a", { href: info ? info.htmlUrl : "#", title: info ? info.title : "", onClick: function (e) { openUrl(e, info && info.htmlUrl); } },
					h("span", { className: PREFIX + "-num" }, "#" + n),
					info ? info.title : ""),
				h("button", {
					className: PREFIX + "-btn " + PREFIX + "-mini" + (ov === "pin" ? " on" : ""),
					title: ov === "pin" ? "優先を解除" : "先にやる",
					disabled: props.busy,
					onClick: function () { props.act("override", { issue: n, action: ov === "pin" ? "clear" : "pin" }); },
				}, "優先"),
				h("button", {
					className: PREFIX + "-btn " + PREFIX + "-mini" + (ov === "defer" ? " on" : ""),
					title: ov === "defer" ? "後回しを解除" : "後回しにする",
					disabled: props.busy,
					onClick: function () { props.act("override", { issue: n, action: ov === "defer" ? "clear" : "defer" }); },
				}, "後回し"));
		}

		function Package(props) {
			var p = props.pkg;
			var st = STATUS[p.status] || { label: p.status, cls: "" };
			var isNext = props.view.nextId === p.id;
			var canStart = p.status === "ready" || p.status === "in_progress";
			var why = [];
			for (var i = 0; i < p.rationale.length && why.length < 2; i++) {
				var text = describe(p.rationale[i]);
				if (text) why.push(text);
			}
			if (p.dependsOn.length) why.push("先に " + p.dependsOn.join(", "));
			if (p.blockedByExternal.length) why.push("外部ブロッカー " + p.blockedByExternal.map(function (n) { return "#" + n; }).join(" "));
			return h("div", { className: PREFIX + "-pkg" + (isNext ? " next" : "") },
				h("div", { className: PREFIX + "-pkghead" },
					h("span", { className: PREFIX + "-pkgid" }, p.id),
					h("span", { className: PREFIX + "-badge " + st.cls }, st.label),
					h("span", { title: "S=1 M=2 L=4" }, "規模 " + p.size),
					h("span", { className: PREFIX + "-spacer" }),
					canStart ? h("button", {
						className: PREFIX + "-btn" + (isNext ? " primary" : ""),
						disabled: props.busy || !props.view.canKickoff,
						title: props.view.canKickoff ? "このパッケージをエージェントに渡す（/issues next " + p.id + "）" : "このセッションのエージェントが見つかりません",
						onClick: function () { props.act("next", { packageId: p.id }); },
					}, p.status === "in_progress" ? "続ける" : "これに着手") : null),
				p.issues.map(function (n) { return h(IssueRow, { key: n, n: n, view: props.view, busy: props.busy, act: props.act }); }),
				why.length ? h("div", { className: PREFIX + "-why" }, why.join(" / ")) : null);
		}

		function PlanTab(props) {
			var scope = (props && props.scope) || {};
			var visible = props ? props.visible !== false : true;
			var st = react.useState(null), view = st[0], setView = st[1];
			var er = react.useState(null), error = er[0], setError = er[1];
			var nt = react.useState(null), notice = nt[0], setNotice = nt[1];
			var bz = react.useState(false), busy = bz[0], setBusy = bz[1];
			var base = { sessionId: scope.sessionId, cwd: scope.cwd };

			var run = function (endpoint, extra, quiet) {
				setBusy(true);
				if (!quiet) setNotice(null);
				var payload = Object.assign({}, base, extra || {});
				return call(endpoint, payload).then(function (value) {
					setError(null);
					if (endpoint === "next") {
						setNotice(value.packageId + " をエージェントに渡しました。チャット欄で方針を確認してください。");
						return call("plan", base).then(setView);
					}
					if (value && value.synced) {
						var s = value.synced;
						setNotice(s.unchanged ? "同期しました（変更なし）" : "同期しました: 変更 " + s.changed + " / クローズ " + s.closed);
					}
					setView(value);
				}).catch(function (e) {
					setError(e && e.message ? e.message : String(e));
				}).then(function () { setBusy(false); });
			};

			react.useEffect(function () {
				if (!visible) return undefined;
				run("plan", null, true);
				var timer = window.setInterval(function () { run("plan", null, true); }, POLL_MS);
				return function () { window.clearInterval(timer); };
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [visible, scope.sessionId, scope.cwd]);

			var plan = view && view.plan;
			var children = [];
			if (error) children.push(h("div", { key: "err", className: PREFIX + "-err" }, error));
			if (notice) children.push(h("div", { key: "ok", className: PREFIX + "-ok" }, notice));
			if (!view && !error) children.push(h("div", { key: "loading", className: PREFIX + "-meta" }, "読み込み中…"));

			if (plan) {
				if (view.inProgress) {
					children.push(h("div", { key: "wip", className: PREFIX + "-ok" },
						"作業中: " + view.inProgress.issues.map(function (n) { return "#" + n; }).join(" ") + (view.inProgress.branch ? "（" + view.inProgress.branch + "）" : ""),
						" ",
						h("button", { className: PREFIX + "-btn " + PREFIX + "-mini", disabled: busy, onClick: function () { run("done"); } }, "作業中を解除")));
				}
				if (!plan.workPackages.length) children.push(h("div", { key: "empty", className: PREFIX + "-meta" }, "計画に入る Issue はありません。"));
				plan.workPackages.forEach(function (p) {
					children.push(h(Package, { key: p.id, pkg: p, view: view, busy: busy, act: run }));
				});
				if (plan.needsHuman.length) {
					children.push(h("div", { key: "nh", className: PREFIX + "-section" }, "人の判断が必要"));
					plan.needsHuman.forEach(function (x) {
						var reason = x.reason === "dependency-cycle" ? "依存が循環" : "内容が不明確";
						children.push(h("div", { key: "nh" + x.issue },
							h(IssueRow, { n: x.issue, view: view, busy: busy, act: run }),
							h("div", { className: PREFIX + "-why" }, reason + (x.detail ? "（" + x.detail + "）" : ""))));
					});
				}
				if (plan.warnings.length) {
					children.push(h("div", { key: "wh", className: PREFIX + "-section" }, "警告"));
					plan.warnings.slice(0, 10).forEach(function (w, i) {
						children.push(h("div", { key: "w" + i, className: PREFIX + "-why" }, "#" + w.issue + " " + w.detail));
					});
				}
			}

			var meta = view
				? "最終同期 " + fmtTime(view.lastSyncAt) +
					" · 判定モデル " + (plan.decision.available ? plan.decision.provider : "なし") +
					" · 累計 " + view.usage.questions + " 問" +
					(view.lastSyncError ? " · 同期エラー: " + view.lastSyncError : "")
				: "";

			return h("div", { className: PREFIX },
				h("div", { className: PREFIX + "-head" },
					h("span", { className: PREFIX + "-repo", title: view ? view.repo : "" }, view ? view.repo : "Issue 計画"),
					h("button", { className: PREFIX + "-btn", disabled: busy, title: "GitHub と今すぐ同期", onClick: function () { run("sync"); } }, busy ? "…" : "同期")),
				meta ? h("div", { className: PREFIX + "-meta", title: plan && plan.decision.note ? plan.decision.note : "" }, meta) : null,
				h("div", { className: PREFIX + "-body" }, children));
		}

		var icon = function (size) {
			return h("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": "true" },
				h("circle", { cx: 8, cy: 8, r: 6 }),
				h("circle", { cx: 8, cy: 8, r: 1.5, fill: "currentColor", stroke: "none" }));
		};

		function apply(ctx) {
			var styleTag = null;
			var disposeTab = null;
			var retry = null;
			try {
				styleTag = window.document.createElement("style");
				styleTag.setAttribute("data-" + PREFIX, "");
				styleTag.textContent = CSS;
				window.document.head.appendChild(styleTag);

				var connection = ctx.get("connection");
				if (connection !== undefined && connection !== null && connection.rpc !== undefined) rpc = connection.rpc;

				var bind = function () {
					var sidebar = ctx.get("betterSidebar");
					if (!sidebar || typeof sidebar.registerTab !== "function") return false;
					if (disposeTab !== null) return true;
					try {
						disposeTab = sidebar.registerTab({
							id: TAB_ID,
							title: function () { return "Issue 計画"; },
							description: function () { return "GitHub Issue の作業パッケージ計画（同期・着手・後回し・優先）"; },
							icon: icon,
							order: 55,
							single: true,
							component: PlanTab,
						});
					} catch (error) {
						window.console.error("dsh-issue-priority: could not register the sidebar tab", error);
					}
					return true;
				};
				if (!bind() && typeof ctx.interval === "function") {
					var attempts = 0;
					retry = ctx.interval(function () {
						attempts += 1;
						if (!bind() && attempts <= 30) return;
						if (retry !== null) { retry(); retry = null; }
					}, 1000);
				}
			} catch (error) {
				window.console.error("dsh-issue-priority: client apply failed", error);
			}

			try {
				ctx.effect(function () {
					return function () {
						if (retry !== null) { try { retry(); } catch (e) { /* gone */ } retry = null; }
						if (typeof disposeTab === "function") { try { disposeTab(); } catch (e) { /* gone */ } }
						disposeTab = null;
						if (styleTag !== null) styleTag.remove();
						rpc = null;
					};
				}, "dsh-issue-priority: sidebar tab");
			} catch (error) {
				window.console.error("dsh-issue-priority: could not register teardown", error);
			}
		}

		exports.apply = apply;
		exports.inject = ["connection", "timer"];
		exports.name = "dsh-issue-priority";
		return module.exports;
	},
});
