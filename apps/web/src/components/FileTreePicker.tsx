"use client";

import { useMemo, useState } from "react";
import type { ImportTreeNode, ListTreeResult } from "@/lib/rpc/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { MAX_FILE_KIB } from "@/components/importPickerShared";

/** The role a picked file is assigned. Hook is deliberately NOT offered in v1
 *  (F3: the IR + import path only handle agent | command). */
export type PickedRole = "ignore" | "agent" | "command";

export interface PickedEntry {
  role: PickedRole;
  /** the classified artifact's id (present once readImportFile+classify ran). */
  artifactId?: string;
  /** UI-only warning (F2/T3) — the no-frontmatter fallback message. Never
   *  persisted onto the IR. */
  warning?: string;
  /** a soft readImportFile failure reason, if the on-demand read failed
   *  (too-large/binary/not-found/denied) — surfaced inline on the row. */
  readError?: string;
}

export interface FileTreePickerProps {
  tree: ListTreeResult;
  /** owned by the parent dialog (same rule as the `selected` set). */
  picked: Map<string, PickedEntry>;
  /** parent handles readImportFile + classifyPickedFile on a non-ignore role. */
  onRoleChange: (node: ImportTreeNode, role: PickedRole) => void;
}

/** A node augmented with its child relPaths, for the collapsible render. */
interface TreeShapeNode {
  node: ImportTreeNode;
  children: TreeShapeNode[];
}

/**
 * buildTree — reconstruct nesting from the flat, parent-before-child node list
 * (PLAN §3 design note). Keyed by relPath; each node's parent is the relPath
 * with its last `/segment` removed. Root-level nodes (no `/`) are the top level.
 */
function buildTree(nodes: ImportTreeNode[]): TreeShapeNode[] {
  const byRel = new Map<string, TreeShapeNode>();
  for (const node of nodes) {
    byRel.set(node.relPath, { node, children: [] });
  }
  const roots: TreeShapeNode[] = [];
  for (const node of nodes) {
    const shape = byRel.get(node.relPath)!;
    const slash = node.relPath.lastIndexOf("/");
    if (slash < 0) {
      roots.push(shape);
      continue;
    }
    const parentRel = node.relPath.slice(0, slash);
    const parent = byRel.get(parentRel);
    if (parent) {
      parent.children.push(shape);
    } else {
      // Parent was pruned (e.g. depth cap) but child slipped in — surface at root
      // rather than dropping it silently.
      roots.push(shape);
    }
  }
  return roots;
}

const MAX_FILE_BYTES = MAX_FILE_KIB * 1024;

export function FileTreePicker({ tree, picked, onRoleChange }: FileTreePickerProps) {
  const roots = useMemo(() => buildTree(tree.nodes), [tree.nodes]);

  if (tree.nodes.length === 0) {
    return <p className="py-4 text-center text-sm text-text-muted">No files found.</p>;
  }

  return (
    <div className="space-y-2">
      {tree.truncated && (
        <p className="rounded-sm border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning">
          ⚠ Results truncated ({tree.truncatedReasons.join(", ")}) — this repo is large; some files
          are not shown.
        </p>
      )}
      <div className="max-h-72 overflow-y-auto rounded-panel border border-border-input p-1 text-sm">
        {roots.map((shape) => (
          <TreeRow
            key={shape.node.relPath}
            shape={shape}
            depth={0}
            picked={picked}
            onRoleChange={onRoleChange}
          />
        ))}
      </div>
    </div>
  );
}

interface TreeRowProps {
  shape: TreeShapeNode;
  depth: number;
  picked: Map<string, PickedEntry>;
  onRoleChange: (node: ImportTreeNode, role: PickedRole) => void;
}

function TreeRow({ shape, depth, picked, onRoleChange }: TreeRowProps) {
  const { node, children } = shape;
  const [expanded, setExpanded] = useState(depth < 1);
  const indent = { paddingLeft: `${depth * 14 + 4}px` };

  if (node.isDir) {
    const expandable = !node.ignored && children.length > 0;
    return (
      <div>
        <div
          className={`flex items-center gap-1.5 py-0.5 ${node.ignored ? "text-text-dim" : "text-text-body"}`}
          style={indent}
        >
          {expandable ? (
            <button
              type="button"
              className="w-4 shrink-0 text-text-muted hover:text-text-body"
              onClick={() => setExpanded((e) => !e)}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span className="shrink-0">📁</span>
          <span className={node.ignored ? "italic" : ""}>{node.name}</span>
          {node.ignored && <span className="text-[10px] uppercase tracking-wide">(ignored)</span>}
          {node.isSymlink && <span className="text-[10px] text-text-dim">↳ symlink</span>}
        </div>
        {expandable && expanded && (
          <div>
            {children.map((child) => (
              <TreeRow
                key={child.node.relPath}
                shape={child}
                depth={depth + 1}
                picked={picked}
                onRoleChange={onRoleChange}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File row.
  const disabledReason = fileDisabledReason(node);
  const entry = picked.get(node.relPath);
  const role: PickedRole = entry?.role ?? "ignore";

  const row = (
    <div className="flex items-center gap-1.5 py-0.5 text-text-body" style={indent}>
      <span className="w-4 shrink-0" />
      <Checkbox
        checked={role !== "ignore"}
        disabled={!!disabledReason}
        onChange={(e) => onRoleChange(node, e.target.checked ? "agent" : "ignore")}
      />
      <span className={`min-w-0 flex-1 truncate ${disabledReason ? "text-text-dim" : ""}`}>
        {node.name}
      </span>
      {entry?.warning && (
        <span className="shrink-0 text-warning" title={entry.warning}>
          ⚠
        </span>
      )}
      {entry?.readError && (
        <span className="shrink-0 text-xs text-danger" title={entry.readError}>
          ✗
        </span>
      )}
      <select
        className="shrink-0 rounded-sm border border-border-input bg-bg-input px-1 py-0.5 text-xs disabled:opacity-50"
        value={role}
        disabled={!!disabledReason}
        onChange={(e) => onRoleChange(node, e.target.value as PickedRole)}
      >
        <option value="ignore">Ignore</option>
        <option value="agent">Agent</option>
        <option value="command">Command</option>
      </select>
    </div>
  );

  if (disabledReason) {
    return <Tooltip content={disabledReason}>{row}</Tooltip>;
  }
  return row;
}

/** Returns a human reason string if the file cannot be picked (oversized /
 *  likely-binary), else undefined. Size is known from the tree walk; no read is
 *  attempted here (PLAN §4). */
function fileDisabledReason(node: ImportTreeNode): string | undefined {
  if (node.likelyBinary) return "Binary file — cannot be imported as an agent/command.";
  if (typeof node.size === "number" && node.size > MAX_FILE_BYTES) {
    return `File is larger than ${MAX_FILE_KIB} KiB — cannot be imported.`;
  }
  return undefined;
}
