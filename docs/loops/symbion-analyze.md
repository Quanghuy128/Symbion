# Symbion — Analyze (Kết quả phase ANALYZE)

> **Dự án MỚI, riêng biệt với GeoChat.** Tài liệu này là output của `/analyze` (3 BA agent song song: requirements + solutions + ideas) đã được tổng hợp + chốt scope qua hỏi-đáp với user.
> Ngày: 2026-06-25. Trạng thái: scope v1 đã LOCKED, sẵn sàng cho `/design`.

---

## 1. Một câu tóm tắt (reframe)

User mô tả "trình kéo-thả tạo file `.md`", nhưng **giá trị thật** = **một định nghĩa workflow chuẩn duy nhất (canonical IR) → compile ra N format provider → ghi/đồng bộ xuống các project**. Canvas kéo-thả và nút "Run" chỉ là lớp vỏ; lõi là **compiler + upsert engine**.

### Pain gốc
- Build project mới có autoworkflow = viết tay nhiều file `.md` (subagent / command) + `settings.json` + hook → tốn thao tác, dễ sai frontmatter.
- Multi-project drift: cùng một autoworkflow copy-paste ở N repo; sửa `/analyze` hay agent `ba` phải áp lại từng repo (pain #2 — **để v1.5**, xem §6).

---

## 2. Scope v1 đã CHỐT

| Hạng mục | Quyết định |
|---|---|
| **Repo** | Dự án mới, tách khỏi GeoChat |
| **Deploy** | `npm start` → daemon (Node) bật lên + menu terminal (Web UI / Terminal UI / Hide to Tray / Exit) → chọn Web UI → mở `localhost:PORT`. Daemon lo fs/git/CLI; web UI nói chuyện với daemon qua localhost RPC |
| **Run engine** | **Defer v2.** v1 chỉ nút **"Copy run command"** (xuất prompt/CLI để paste) |
| **Providers** | **Claude** (`.claude/agents/*.md` + `.claude/commands/*.md`) + **Codex** (`AGENTS.md` ở root). IR thiết kế sẵn để THÊM Copilot/Gemini sau (không viết lại) |
| **Multi-project** | **Solo** — 1 project 1 quy trình độc lập. Shared library (giải pain #2) → **v1.5** |
| **UI** | **Form/Markdown editor 2-tab là core** + **graph read-only** auto-gen. KHÔNG canvas 2D tự do kiểu n8n/Dify |

### Menu terminal mẫu (ý tưởng user — ĐÚNG pattern)
```
========================================
  Choose Interface (v0.1.0)
  🚀 Server: http://localhost:20128
========================================
  ☆ Web UI (Open in Browser)
  ☆ Terminal UI (Interactive CLI)
  ☆ Hide to Tray (Background)
  ☆ Exit
```

---

## 3. Requirements (Agent 1 — Requirements Analyst)

### Ground truth về format (đã verify từ `.claude/` của GeoChat)
| Artifact | Path | Frontmatter | Body |
|---|---|---|---|
| **Agent (subagent)** | `.claude/agents/<name>.md` | `name`, `description`, `tools` (CSV, vd `Read, Grep, Glob, Write`) | system prompt (sections: Principles / Output / IMPORTANT / boundaries) |
| **Command (slash)** | `.claude/commands/<name>.md` | `description` (body dùng `$ARGUMENTS`) | prompt / orchestration script |
| **Hook / settings** | `.claude/settings.json` + `.claude/hooks/*.sh` | JSON | shell |

### Functional Requirements (v1)
- **FR-1 Project mgmt:** tạo project (Tên + Path repo), list/select ở sidebar trái, section "Cấu hình" cho setting global.
- **FR-2 Workflow builder** → tạo command `.md`. 2 tab: **Form** (fields → auto-convert `.md`) và **Markdown** (template + paste).
- **FR-3 Agent builder** → tạo agent `.md`. Form khớp frontmatter thật (`name`, `description`, `tools` multi-select) + **custom field** (key/value tùy ý). 2 tab giống FR-2.
- **FR-4 Export/Upsert ("Xuất bản"):** chọn version + target (Claude/Codex v1) → upsert vào path project. Claude → `.claude/agents` + `.claude/commands`; Codex → `AGENTS.md`.
- **FR-5 Copy run command (thay cho Run):** modal requirement + model + option → render prompt cấu trúc (`/autoplan [Requirements][Model][option]`) → copy clipboard.
- **FR-6 Versioning:** chọn version khi publish → lưu lịch sử snapshot, diff, rollback (scope cụ thể chốt ở /plan).
- **FR-7 Import:** parse `.claude/` có sẵn của 1 repo vào model (chống cold-start).

### Non-Functional Requirements
- **NFR-1 Filesystem access** ghi `.claude/` tại path bất kỳ → bắt buộc lớp local (daemon). Web thuần KHÔNG làm được.
- **NFR-2 Upsert an toàn / reversible** — idempotent, không xóa file lạ, có backup/git-aware (đúng tinh thần DB-safety của GeoChat).
- **NFR-3 Format fidelity** — `.md` sinh ra byte-valid; round-trip import→edit→export không corrupt.
- **NFR-4 Validation** — frontmatter sai, tên trùng, filename illegal, thiếu field bắt buộc → bắt trước khi ghi.
- **NFR-5 Portability** — 1 canonical model → N output; format change cô lập trong adapter.

### Acceptance Criteria (rút gọn)
- **AC-W1:** form → `.md` có đúng `description:` + body, diff sạch so với bản viết tay, parse được.
- **AC-A1/A2:** agent có `name/description/tools` hợp lệ; custom field xuất hiện nguyên văn trong frontmatter.
- **AC-E1:** publish Claude → ghi/update `.claude/agents` + `.claude/commands`; file lạ KHÔNG bị đụng.
- **AC-E2:** re-publish cùng version → idempotent (không diff thừa).
- **AC-E3:** file đã sửa tay từ publish trước → detect conflict, KHÔNG đè im lặng (warn/confirm).
- **AC-R1:** "Copy run command" → đúng prompt string với `[Requirements]/[Model]/[option]` đã thay, hiện cho user thấy trước.

---

## 4. Solution / Architecture (Agent 2 — Solution Architect)

### ⚠️ Fork khái niệm đã giải: canvas KHÔNG phải executor
n8n/Dify node = DAG thực thi thật. Slash-command/agent Claude Code = **file phẳng**; `/autopilot` gọi 5 agent chỉ vì *văn bản* trong file. KHÔNG compile canvas thành thứ tự thực thi đảm bảo được.
→ **Quyết định: canvas = bản đồ phụ thuộc read-only (catalog), không phải executor.** Data model thiết kế để sau nâng lên orchestration thật (v2+) nếu cần.

### Deploy model đã chọn: Local daemon + web UI
```
[Browser: Next.js UI] <--localhost RPC--> [daemon (Node)]
                                              |- đọc/ghi .claude/, AGENTS.md
                                              |- git ops
                                              |- serve localhost + menu terminal
```

### Stack đề xuất (monorepo)
- **`packages/core`** — Canonical IR + render engine + adapter (Claude, Codex) + upsert/diff engine + version logic. **Pure functions, framework-agnostic, test rẻ (Vitest).** ~80% correctness ở đây.
- **`apps/daemon`** — lớp đặc quyền (TS/Node): fs upsert, git, menu terminal, localhost RPC. Có thể nâng cấp serve `claude -p` ở v2.
- **`apps/web`** — Next.js App Router + Tailwind + shadcn. Graph view dùng **React Flow** (read-only). Form/MD editor là core.

> Quyết định cấu trúc quan trọng nhất: **`packages/core` tách rời cả web lẫn daemon** qua RPC typed → đổi UI stack/đổi lớp đặc quyền sau này không phải viết lại.

### Canonical IR (sketch)
```ts
type CanonicalArtifact = {
  kind: "agent" | "command"
  name: string
  description: string
  tools?: string[]          // agent only
  argumentsHint?: string    // command only ($ARGUMENTS)
  body: string              // prompt markdown
  customFields?: Record<string,string>  // vd temperature/model nếu user thêm
  meta: { version: string; sourceTemplateId?: string }
}
```
Mỗi target = pure function `(CanonicalArtifact) => RenderedFile[]`:

| Target (v1) | Agent | Command |
|---|---|---|
| **Claude** | `.claude/agents/<name>.md` (`name/description/tools`) | `.claude/commands/<name>.md` (`description` + `$ARGUMENTS`) |
| **Codex** | gộp vào `AGENTS.md` (root) | gộp vào `AGENTS.md` (không có command primitive) |

Adapter khai báo **capability** (`supportsCommands`, `supportsPerAgentFile`, `fileFormat`) → UI greyed-out / cảnh báo export lossy. Thêm Copilot (`.github/`) + Gemini (TOML `.gemini/commands/`) sau là thêm adapter, không sửa IR.

### Upsert mechanics (an toàn)
1. Render ra temp tree.
2. **Diff với file hiện tại → show diff trong UI trước khi ghi** (không bao giờ đè im lặng).
3. Marker `<!-- managed-by: symbion id=... version=... -->` để phân biệt file tool-owned vs sửa tay → detect conflict.
4. Reversible: mỗi publish lưu snapshot/backup (hoặc dựa git).
5. Validate path tồn tại + khởi tạo `.claude/` nếu chưa có.

### Edge cases & rủi ro
- File sửa tay → KHÔNG clobber (marker + hash → conflict UI).
- Frontmatter `tools:` tham chiếu tool không tồn tại; `name` lệch filename.
- Publish N project: partial failure → trạng thái per-project + retry.
- Format drift của Claude Code → cô lập trong adapter.
- **Run (v2):** token cost runaway, sandbox, kill switch, auth (dùng auth local của user, KHÔNG thu API key qua web).

### Complexity v1 ≈ **L** (full vision có graph-orchestration = XL)

---

## 5. Ideas & Open Questions (Agent 3)

### 10x ideas (ưu tiên)
1. **Canonical IR + provider compilers = moat thật.** Khi workflow dùng "parallel subagents" mà target không hỗ trợ → badge cảnh báo *"provider X không spawn agent song song, sẽ compile thành tuần tự — OK?"*. Sự trung thực này chính là sản phẩm.
2. **Import/reverse-engineer `.claude/` có sẵn** → chống cold-start (đã đưa vào v1 = FR-7).
3. **Lint graph** — bắt: command tham chiếu agent không tồn tại; `tools:` thiếu tool mà body cần; `$ARGUMENTS` lủng lẳng; step không reachable.
4. **Git PR export** (v1.5) — thay vì ghi đè im lặng, mở PR `.claude/` để review.
5. **Drift detection** (v1.5/v2) — phát hiện file on-disk lệch khỏi model.
6. **Shared library + inheritance/override + propagate-to-N** (v1.5) — giải pain #2.

### Quan điểm UX đã chốt
Drag-drop canvas tự do **là SAI metaphor** (artifact 80% là rich-text prompt, không phải data-flow). → **Chốt: Form 2-tab (core) + graph phụ thuộc read-only.** Drag (nếu có) chỉ để sắp thứ tự step trong 1 command, không phải canvas 2D.

### 3 conflict đã giải
- **"Temperature/Model"** không có trong frontmatter Claude → lưu thành **custom field** (assistant bỏ qua) hoặc bỏ. Chốt cụ thể ở `/design`.
- **"Workflow = canvas DAG?"** → KHÔNG; workflow = 1 file command `.md`, canvas chỉ là bản đồ read-only.
- **"Run chạy ở đâu?"** → defer v2; v1 = Copy command.

---

## 6. Roadmap phân lớp

- **v1 (L):** project mgmt (solo) · agent/command builder (form+md 2-tab) · import `.claude/` · graph read-only · compile Claude + Codex · upsert + diff preview · versioning + rollback · Copy run command · daemon + menu terminal + web UI.
- **v1.5:** shared library + inheritance/override + propagate-to-N (pain #2) · Git PR export · Copilot adapter.
- **v2:** Run engine thật (headless `claude -p`, stream, auth, kill switch) · drift detection · Gemini adapter (MD→TOML) · marketplace/template sharing.

---

## 7. Next step
Scope v1 đã rõ → bỏ qua `/office-hours`, đi tới **`/design`** (chốt UI/UX cụ thể: layout sidebar, form fields agent vs command, graph view, luồng Xuất bản + diff preview, menu terminal) → rồi `/plan` (architecture + data model + test plan).

> Lưu ý: đây là repo mới. Khi tạo repo Symbion, copy tài liệu này vào `docs/loops/` của repo đó làm STATE khởi đầu.
