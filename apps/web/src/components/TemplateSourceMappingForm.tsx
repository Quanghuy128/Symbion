"use client";

import type { SourceFolder } from "@/lib/rpc/types";
import { Field, Select } from "@/components/ui/input";

type Bucket = SourceFolder["bucket"];

export interface TemplateSourceMappingFormProps {
  rootDirs: Array<{ path: string; mdFiles: number; skillFiles: number }>;
  detected: Array<SourceFolder & { count: number }>;
  /** currently chosen folders (max 1 per bucket); missing bucket = "— none —". */
  value: SourceFolder[];
  /** emits ONLY the non-"none" rows. */
  onChange: (folders: SourceFolder[]) => void;
}

const BUCKETS: Array<{ bucket: Bucket; label: string }> = [
  { bucket: "agent", label: "Agents" },
  { bucket: "command", label: "Commands" },
  { bucket: "skill", label: "Skills" },
];

/** Pre-fill value from daemon detection. */
export function initialFolders(detected: Array<SourceFolder & { count: number }>): SourceFolder[] {
  return detected.map((d) => ({ bucket: d.bucket, path: d.path }));
}

/**
 * TemplateSourceMappingForm — 3 selects (Agents / Commands / Skills). Options
 * are only paths the DAEMON reported (the daemon re-checks them on add).
 * Presentational; the dialog owns the state.
 */
export function TemplateSourceMappingForm({ rootDirs, detected, value, onChange }: TemplateSourceMappingFormProps) {
  function setBucket(bucket: Bucket, path: string) {
    const rest = value.filter((f) => f.bucket !== bucket);
    onChange(path === "" ? rest : [...rest, { bucket, path }]);
  }

  return (
    <div className="space-y-3">
      {BUCKETS.map(({ bucket, label }) => {
        const current = value.find((f) => f.bucket === bucket)?.path ?? "";
        const count = (d: { mdFiles: number; skillFiles: number }) => (bucket === "skill" ? d.skillFiles : d.mdFiles);
        const noun = bucket === "skill" ? "SKILL.md" : ".md";
        const known = new Set(rootDirs.map((d) => d.path));
        const extra = detected.filter((d) => d.bucket === bucket && !known.has(d.path));
        const id = `mapping-${bucket}`;
        return (
          <Field key={bucket} label={label} htmlFor={id}>
            <Select id={id} value={current} onChange={(e) => setBucket(bucket, e.target.value)}>
              <option value="">— none —</option>
              {rootDirs.map((d) => (
                <option key={d.path} value={d.path}>
                  {d.path === "." ? "(this folder)" : d.path} ({count(d)} {noun})
                </option>
              ))}
              {extra.map((d) => (
                <option key={d.path} value={d.path}>
                  {d.path} ({d.count} files)
                </option>
              ))}
            </Select>
          </Field>
        );
      })}
    </div>
  );
}
