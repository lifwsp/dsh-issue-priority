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
			"." + PREFIX + "-next{border:1.5px solid var(--dsw-alias-state-business-primary,#3b82f6);border-radius:10px;padding:10px;margin:8px 0 4px;}",
			"." + PREFIX + "-label{font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--dsw-alias-state-business-primary,#3b82f6);margin-bottom:4px;}",
			"." + PREFIX + "-hint{margin:8px 0;padding:6px 8px;border-radius:6px;font-size:11px;line-height:1.5;background:var(--dsw-alias-state-warn-bg,rgba(217,119,6,.10));}",
			"." + PREFIX + "-hint>div+div{margin-top:4px;}",
			"." + PREFIX + "-size{opacity:.7;font-size:11px;}",
			"." + PREFIX + "-badge.prio-high{background:var(--dsw-alias-state-danger-primary,#dc2626);color:#fff;}",
			"." + PREFIX + "-badge.prio-low{opacity:.7;}",
			"." + PREFIX + "-row{border-bottom:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.18));padding:4px 0;}",
			"." + PREFIX + "-rowhead{display:flex;align-items:center;gap:6px;}",
			"." + PREFIX + "-rowtitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}",
			"." + PREFIX + "-rowbody{padding:2px 0 4px 18px;}",
			"." + PREFIX + "-toggle{font:inherit;border:none;background:none;color:inherit;cursor:pointer;padding:0 2px;opacity:.6;}",
			"." + PREFIX + "-why>div{margin-top:2px;}",
			"." + PREFIX + "-icon{font:inherit;font-size:11px;font-weight:700;width:18px;height:18px;line-height:16px;padding:0;border-radius:50%;text-align:center;cursor:help;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.35));background:transparent;color:inherit;opacity:.55;flex:none;}",
			"." + PREFIX + "-icon.alert{opacity:1;border-color:transparent;background:var(--dsw-alias-state-warn-primary,#d97706);color:#fff;}",
			"." + PREFIX + "-icon.small{width:15px;height:15px;line-height:13px;font-size:10px;}",
			"." + PREFIX + "-pop{margin:6px 10px 0;padding:6px 8px;border-radius:6px;font-size:11px;line-height:1.5;white-space:pre-wrap;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.12));}",
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

		var PRIO = { high: "高", medium: "中", low: "低" };

		function describe(r) {
			switch (r.kind) {
				case "files-overlap": return "#" + r.issues[0] + " と #" + r.issues[1] + " が同じファイル（" + r.files.slice(0, 2).join(", ") + "）を触る";
				case "area-match": return "#" + r.issues[0] + " と #" + r.issues[1] + " が同じ領域（" + r.areas.join(", ") + "）";
				case "decision-merge": return "#" + r.issues[0] + " と #" + r.issues[1] + " は一緒に片付けるのが自然";
				case "similar-text": return "";
				case "hard-dependency": return "#" + r.issue + " は #" + r.dependsOn + " の後";
				case "advisory-order": return "#" + r.before + " → #" + r.after + " の順がよさそう";
				case "priority": return "#" + r.issue + " の重要度が" + PRIO[r.level] + "（" + (r.source === "github" ? "GitHub の Priority" : r.source === "label" ? "ラベル" : "判定モデル") + "）";
				case "same-parent": return "#" + r.issues[0] + " と #" + r.issues[1] + " は同じ親 Issue #" + r.parent + " のサブ Issue";
				case "same-milestone": return "#" + r.issues[0] + " と #" + r.issues[1] + " は同じマイルストーン「" + r.milestone + "」";
				case "aging": return "#" + r.issue + " は起票から " + r.days + " 日経過（先送り防止で繰り上げ）";
				case "due": return r.days < 0 ? "#" + r.issue + " のマイルストーン期限切れ" : "#" + r.issue + " のマイルストーン期限まで " + r.days + " 日";
				case "unblocks": return "終わると " + r.count + " 個のパッケージが着手できるようになる";
				case "pinned": return "#" + r.issue + " を優先に指定";
				case "deferred": return "#" + r.issue + " を後回しに指定";
				default: return "";
			}
		}

		function reasons(p, view) {
			var out = [];
			for (var i = 0; i < p.rationale.length; i++) {
				var text = describe(p.rationale[i]);
				if (text && out.indexOf(text) < 0) out.push(text);
			}
			if (p.dependsOn.length) out.push("先に " + p.dependsOn.join(", ") + " が必要");
			if (p.blockedByExternal.length) out.push("計画外の " + p.blockedByExternal.map(function (n) { return "#" + n; }).join(" ") + " 待ち");
			if (p.waitingOnClose && p.waitingOnClose.length) out.push(p.waitingOnClose.map(function (n) { return "#" + n; }).join(" ") + " のクローズ待ち（実装済み）");
			return out;
		}

		/**
		 * Everything about HOW the plan was made, kept out of sight: the header
		 * shows only an icon ("!" when there is something to act on) and these
		 * lines live in its tooltip.
		 */
		function statusInfo(view) {
			var alerts = [];
			var details = [];
			if (!view || !view.plan) return { alerts: alerts, details: details };
			var plan = view.plan;
			var s = view.signals;
			if (view.lastSyncError) alerts.push("同期エラー: " + view.lastSyncError);
			if (view.decisionOff) alerts.push("判定モデルが止まっています（" + view.decisionOff + "）。規模・重要度・まとめ方を判定できないため、Issue 番号順で並べています。");
			else if (plan.decision.note && /error/i.test(plan.decision.note)) alerts.push("判定モデルでエラーが出ています: " + plan.decision.note);
			if (s && s.open > 0 && view.decisionOff && s.withPriority === 0) alerts.push("重要度を示すラベル（priority:high など）が付いた Issue がありません。");
			plan.warnings.slice(0, 10).forEach(function (w) { alerts.push("#" + w.issue + " " + w.detail); });
			details.push("最終同期 " + fmtTime(view.lastSyncAt));
			details.push("判定モデル " + (plan.decision.available ? (plan.decision.model || plan.decision.provider) + "（" + plan.decision.provider + " 経由）" : "なし"));
			details.push("判定モデルへの質問 累計 " + view.usage.questions + " 問");
			if (s && s.open > 0) details.push("dsh-plan ブロック付き " + s.withBlock + " / " + s.open + " 件");
			if (plan.decision.note && !/error/i.test(plan.decision.note)) details.push(plan.decision.note);
			if (view.outcomes) details.push("計画の採用状況: " + view.outcomes);
			return { alerts: alerts, details: details };
		}

		/**
		 * Small round icon whose details live in the hover tooltip; clicking it
		 * toggles the same text inline (for touch / copying). "!" when something
		 * deserves attention, "i" otherwise.
		 */
		function InfoIcon(props) {
			var lines = props.lines.filter(Boolean);
			if (!lines.length) return null;
			return h("button", {
				type: "button",
				className: PREFIX + "-icon" + (props.alert ? " alert" : "") + (props.small ? " small" : ""),
				title: lines.join("\n"),
				"aria-label": lines.join(" "),
				onClick: props.onToggle,
			}, props.alert ? "!" : "i");
		}

		function openUrl(event, url) {
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

		function StartButton(props) {
			var p = props.pkg;
			if (p.status !== "ready" && p.status !== "in_progress") return null;
			return h("button", {
				className: PREFIX + "-btn" + (props.primary ? " primary" : ""),
				disabled: props.busy || !props.view.canKickoff,
				title: props.view.canKickoff ? "このパッケージをエージェントに渡す（/issues next " + p.id + "）" : "このセッションのエージェントが見つかりません",
				onClick: function () { props.act("next", { packageId: p.id }); },
			}, p.status === "in_progress" ? "続ける" : (props.primary ? "これに着手" : "着手"));
		}

		function Badges(p) {
			var st = STATUS[p.status] || { label: p.status, cls: "" };
			var out = [h("span", { key: "s", className: PREFIX + "-badge " + st.cls }, st.label)];
			if (p.prioritySource && p.prioritySource !== "default") {
				out.push(h("span", { key: "p", className: PREFIX + "-badge prio-" + p.priority, title: p.prioritySource === "label" ? "ラベルから" : "判定モデルの推定" }, "重要度 " + PRIO[p.priority]));
			}
			out.push(h("span", { key: "z", className: PREFIX + "-size", title: "S=1 M=2 L=4" }, "規模 " + p.size));
			return out;
		}

		/** The recommended package, shown large with its reasons. */
		function NextCard(props) {
			var p = props.pkg;
			var why = reasons(p, props.view);
			var op = react.useState(false), open = op[0], setOpen = op[1];
			return h("div", { className: PREFIX + "-next" },
				h("div", { className: PREFIX + "-label" }, p.status === "in_progress" ? "作業中" : "次はこれ"),
				h("div", { className: PREFIX + "-pkghead" },
					h("span", { className: PREFIX + "-pkgid" }, p.id),
					Badges(p),
					h(InfoIcon, { small: true, lines: ["選んだ理由:"].concat(why.length ? why.map(function (w) { return "・" + w; }) : ["・ほかに決め手がないので、Issue 番号のいちばん小さいもの"]), onToggle: function () { setOpen(!open); } }),
					h("span", { className: PREFIX + "-spacer" }),
					h(StartButton, { pkg: p, view: props.view, busy: props.busy, act: props.act, primary: true })),
				p.issues.map(function (n) { return h(IssueRow, { key: n, n: n, view: props.view, busy: props.busy, act: props.act }); }),
				open ? h("div", { className: PREFIX + "-why" },
					why.length ? why.map(function (w, i) { return h("div", { key: i }, "・" + w); })
						: "ほかに決め手がないので、Issue 番号のいちばん小さいものです。") : null);
		}

		/** Other packages: one compact row each, expandable. */
		function PackageRow(props) {
			var p = props.pkg;
			var op = react.useState(false), open = op[0], setOpen = op[1];
			var first = props.view.issues[String(p.issues[0])];
			var label = "#" + p.issues.join(" #") + (first ? " " + first.title : "");
			return h("div", { className: PREFIX + "-row" },
				h("div", { className: PREFIX + "-rowhead" },
					h("button", { className: PREFIX + "-toggle", onClick: function () { setOpen(!open); }, title: open ? "たたむ" : "詳しく" }, open ? "▾" : "▸"),
					h("span", { className: PREFIX + "-rowtitle", title: label, onClick: function () { setOpen(!open); } }, label),
					Badges(p),
					h(StartButton, { pkg: p, view: props.view, busy: props.busy, act: props.act, primary: false })),
				open ? h("div", { className: PREFIX + "-rowbody" },
					p.issues.map(function (n) { return h(IssueRow, { key: n, n: n, view: props.view, busy: props.busy, act: props.act }); }),
					(function () { var w = reasons(p, props.view); return w.length ? h("div", { className: PREFIX + "-why" }, w.join(" / ")) : null; })())
					: null);
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
			var si = react.useState(false), showInfo = si[0], setShowInfo = si[1];
			var status = statusInfo(view);
			var infoLines = status.alerts.length ? status.alerts.concat([""], status.details) : status.details;
			var children = [];
			if (error) children.push(h("div", { key: "err", className: PREFIX + "-err" }, error));
			if (notice) children.push(h("div", { key: "ok", className: PREFIX + "-ok" }, notice));
			if (!view && !error) children.push(h("div", { key: "loading", className: PREFIX + "-meta" }, "読み込み中…"));

			if (plan) {
				if (view.inProgress) {
					children.push(h("div", { key: "wip", className: PREFIX + "-ok" },
						"作業中: " + view.inProgress.issues.map(function (n) { return "#" + n; }).join(" ") + (view.inProgress.branch ? "（" + view.inProgress.branch + "）" : ""),
						" ",
						h("button", { className: PREFIX + "-btn " + PREFIX + "-mini", disabled: busy, title: "実装が終わった（push・PR 前でもよい）。クローズ待ちにして推奨から外す", onClick: function () { run("done"); } }, "実装完了"),
						" ",
						h("button", { className: PREFIX + "-btn " + PREFIX + "-mini", disabled: busy, title: "完了にせず作業中の印だけ外す", onClick: function () { run("stop"); } }, "中断")));
				}
				if (showInfo && infoLines.length) {
					children.push(h("div", { key: "info", className: PREFIX + "-pop" }, infoLines.join("\n")));
				}
				var next = null;
				for (var i = 0; i < plan.workPackages.length; i++) if (plan.workPackages[i].id === view.nextId) next = plan.workPackages[i];
				if (!plan.workPackages.length) children.push(h("div", { key: "empty", className: PREFIX + "-meta" }, "計画に入る Issue はありません。"));
				else if (!next) children.push(h("div", { key: "nonext", className: PREFIX + "-ok" }, "いま着手できるパッケージはありません（すべて先行待ちかブロック中）。"));
				if (next) children.push(h(NextCard, { key: "next", pkg: next, view: view, busy: busy, act: run }));
				var rest = plan.workPackages.filter(function (p) { return p !== next; });
				if (rest.length) {
					children.push(h("div", { key: "resth", className: PREFIX + "-section" }, "そのあと（" + rest.length + "）"));
					rest.forEach(function (p) { children.push(h(PackageRow, { key: p.id, pkg: p, view: view, busy: busy, act: run })); });
				}
				if (view.awaiting && view.awaiting.length) {
					children.push(h("div", { key: "awh", className: PREFIX + "-section", title: "実装は終わったが GitHub では開いたままの Issue。クローズされると消える" }, "クローズ待ち（" + view.awaiting.length + "）"));
					view.awaiting.forEach(function (a) {
						children.push(h("div", { key: "aw" + a.issue, className: PREFIX + "-row" },
							h("div", { className: PREFIX + "-issue" },
								h("a", { href: (view.issues[String(a.issue)] || {}).htmlUrl || "#", onClick: function (e) { var i = view.issues[String(a.issue)]; openUrl(e, a.urls[0] || (i && i.htmlUrl)); } },
									h("span", { className: PREFIX + "-num" }, "#" + a.issue),
									(view.issues[String(a.issue)] || {}).title || ""),
								h("span", { className: PREFIX + "-badge" }, a.step),
								h("button", {
									className: PREFIX + "-btn " + PREFIX + "-mini",
									title: "まだ終わっていない。計画に戻す",
									disabled: busy,
									onClick: function () { run("reopen", { issue: a.issue }); },
								}, "戻す")),
							h("div", { className: PREFIX + "-why", title: a.evidence.join("\n") }, "→ " + a.next + (a.evidence.length ? "（" + a.evidence.join(" / ") + "）" : ""))));
					});
				}
				if (plan.needsHuman.length) {
					children.push(h("div", { key: "nh", className: PREFIX + "-section" }, "人の判断が必要（" + plan.needsHuman.length + "）"));
					plan.needsHuman.forEach(function (x) {
						var reason = x.reason === "dependency-cycle" ? "依存が循環" : "内容が不明確";
						children.push(h("div", { key: "nh" + x.issue },
							h(IssueRow, { n: x.issue, view: view, busy: busy, act: run }),
							h("div", { className: PREFIX + "-why" }, reason + (x.detail ? "（" + x.detail + "）" : ""))));
					});
				}
			}

			return h("div", { className: PREFIX },
				h("div", { className: PREFIX + "-head" },
					h("span", { className: PREFIX + "-repo", title: view ? view.repo : "" }, view ? view.repo : "Issue 計画"),
					h(InfoIcon, { alert: status.alerts.length > 0, lines: infoLines, onToggle: function () { setShowInfo(!showInfo); } }),
					h("button", { className: PREFIX + "-btn", disabled: busy, title: "GitHub と今すぐ同期", onClick: function () { run("sync"); } }, busy ? "…" : "同期")),
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
