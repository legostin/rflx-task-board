import { useCallback, useEffect, useMemo, useState } from "react";
import { reflex } from "@host/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
} from "@host/ui";

const DEFAULT_PROMPT = `You are deciding which task an agent should pick up next.

Inputs you'll see:
  - READY: array of tasks waiting to be worked on
  - IN_PROGRESS: tasks already being worked on

Pick ONE task (or none). Priorities: high > normal > low. Within a tier, the oldest createdAt wins. Skip tasks whose code areas obviously overlap with something IN_PROGRESS.

Reply with strict JSON: {"taskId": "<id-or-null>", "reason": "<one-line why>"}.`;

interface PickupSettings {
  enabled: boolean;
  prompt: string;
  intervalMinutes: number;
  autoPruneMerged: boolean;
  autoPruneUnmergedAfterDays: number;
}

const DEFAULTS: PickupSettings = {
  enabled: false,
  prompt: DEFAULT_PROMPT,
  intervalMinutes: 15,
  autoPruneMerged: true,
  autoPruneUnmergedAfterDays: 14,
};

interface Worktree {
  dir: string;
  branch?: string;
  isMain: boolean;
  ageDays?: number;
}

const gitApi = reflex.git as unknown as {
  worktree: {
    list: () => Promise<{
      worktrees: Array<{ dir: string; branch?: string; isMain: boolean; head: string }>;
    }>;
    remove: (a: {
      slug: string;
      branch: string;
      force?: boolean;
    }) => Promise<{ ok: boolean }>;
  };
};

const fsApi = reflex.fs as unknown as {
  read: (a: { path: string }) => Promise<string | null>;
  write: (a: { path: string; content: string }) => Promise<{ bytesWritten: number }>;
};

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<PickupSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [runningTick, setRunningTick] = useState(false);
  const [tickResult, setTickResult] = useState<{
    picked: string | null;
    reason: string;
  } | null>(null);

  const runPickupNow = async () => {
    setRunningTick(true);
    try {
      const res = (await reflex.actions.invoke({
        name: "autoPickupTick",
      })) as { picked: string | null; reason: string };
      setTickResult(res);
    } finally {
      setRunningTick(false);
    }
  };

  // --- load settings ---
  useEffect(() => {
    let alive = true;
    void (async () => {
      const txt = await fsApi.read({ path: "data/settings.json" }).catch(() => null);
      if (!alive) return;
      if (txt) {
        try {
          const parsed = JSON.parse(txt) as Partial<PickupSettings>;
          setSettings({
            enabled: !!parsed.enabled,
            prompt:
              typeof parsed.prompt === "string" && parsed.prompt.trim()
                ? parsed.prompt
                : DEFAULTS.prompt,
            intervalMinutes:
              typeof parsed.intervalMinutes === "number"
                ? Math.max(5, Math.min(60, parsed.intervalMinutes))
                : DEFAULTS.intervalMinutes,
            autoPruneMerged:
              typeof parsed.autoPruneMerged === "boolean"
                ? parsed.autoPruneMerged
                : DEFAULTS.autoPruneMerged,
            autoPruneUnmergedAfterDays:
              typeof parsed.autoPruneUnmergedAfterDays === "number"
                ? Math.max(0, Math.min(365, parsed.autoPruneUnmergedAfterDays))
                : DEFAULTS.autoPruneUnmergedAfterDays,
          });
        } catch {
          /* keep defaults */
        }
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- load worktrees ---
  const refreshWorktrees = useCallback(async () => {
    const res = await gitApi.worktree.list().catch(() => ({ worktrees: [] }));
    const now = Date.now();
    setWorktrees(
      res.worktrees
        .filter((w) => !w.isMain)
        .map((w) => ({
          dir: w.dir,
          ...(w.branch ? { branch: w.branch } : {}),
          isMain: w.isMain,
          ageDays: undefined, // git worktree list doesn't include mtime; we'll show created-at via slug if needed
        })),
    );
    void now;
  }, []);

  useEffect(() => {
    void refreshWorktrees();
  }, [refreshWorktrees]);

  // --- save ---
  const save = async () => {
    setSaving(true);
    await fsApi.write({
      path: "data/settings.json",
      content: JSON.stringify(settings, null, 2),
    });
    setSaving(false);
  };

  // --- worktree prune ---
  const [pruning, setPruning] = useState(false);
  const pruneAll = async () => {
    if (worktrees.length === 0) return;
    if (
      !confirm(
        `Remove ${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}? This drops the branch too.`,
      )
    ) {
      return;
    }
    setPruning(true);
    for (const wt of worktrees) {
      if (!wt.branch) continue;
      const slug = wt.dir.split("/").pop() ?? "";
      await gitApi.worktree
        .remove({ slug, branch: wt.branch, force: true })
        .catch(() => null);
    }
    setPruning(false);
    await refreshWorktrees();
  };

  const pruneOne = async (wt: Worktree) => {
    if (!wt.branch) return;
    if (!confirm(`Remove worktree ${wt.branch}?`)) return;
    const slug = wt.dir.split("/").pop() ?? "";
    await gitApi.worktree.remove({ slug, branch: wt.branch, force: true });
    await refreshWorktrees();
  };

  if (!loaded) {
    return (
      <div className="p-4">
        <Button variant="ghost" onClick={onClose}>
          ← Board
        </Button>
        <p className="text-sm text-muted-foreground mt-4">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onClose}>
          ← Board
        </Button>
        <h1 className="text-xl font-semibold">Task board · Settings</h1>
        <div />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Auto-pickup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            When enabled, every tick Reflex looks at the <code>ready</code>{" "}
            column, applies your strategy prompt, and dispatches one task to
            an agent. Off by default — turn on when you trust the board.
          </p>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings((s) => ({ ...s, enabled: e.target.checked }))
              }
            />
            <span className="text-sm font-medium">Enable auto-pickup</span>
          </label>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Tick interval (minutes, 5–60)
            </label>
            <Input
              type="number"
              min={5}
              max={60}
              value={settings.intervalMinutes}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  intervalMinutes: Math.max(
                    5,
                    Math.min(60, Number(e.target.value) || 15),
                  ),
                }))
              }
              className="max-w-[120px]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Strategy prompt
            </label>
            <Textarea
              value={settings.prompt}
              onChange={(e) =>
                setSettings((s) => ({ ...s, prompt: e.target.value }))
              }
              rows={12}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              The LLM sees this prompt plus a JSON of <code>ready</code> +{" "}
              <code>in_progress</code> tasks. It replies with{" "}
              <code>{`{"taskId": ..., "reason": ...}`}</code>.
            </p>
          </div>

          <div className="pt-2 border-t flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={runPickupNow}
              disabled={runningTick}
            >
              {runningTick ? "Running…" : "Run pickup now"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Manual fire — handy for testing your prompt. While the board
              tab is open, Reflex also fires automatically every interval.
            </p>
          </div>
          {tickResult && (
            <p className="text-xs text-muted-foreground border-l-2 border-violet-300 pl-3">
              {tickResult.picked
                ? `Picked ${tickResult.picked}: ${tickResult.reason}`
                : `No pick — ${tickResult.reason}`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Worktrees</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Each code task gets its own git worktree on a branch{" "}
            <code>task/&lt;slug&gt;</code>. Merge cleans them up; you can also
            prune manually here.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.autoPruneMerged}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    autoPruneMerged: e.target.checked,
                  }))
                }
              />
              <span className="text-sm">Auto-prune merged worktrees</span>
            </label>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Auto-prune unmerged after (days, 0 = off)
              </label>
              <Input
                type="number"
                min={0}
                max={365}
                value={settings.autoPruneUnmergedAfterDays}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    autoPruneUnmergedAfterDays: Math.max(
                      0,
                      Math.min(365, Number(e.target.value) || 0),
                    ),
                  }))
                }
                className="max-w-[120px]"
              />
            </div>
          </div>

          <div className="border rounded-md divide-y">
            <div className="flex items-center justify-between p-3">
              <span className="text-sm font-medium">
                Existing worktrees
                <Badge variant="secondary" className="ml-2">
                  {worktrees.length}
                </Badge>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void refreshWorktrees()}
                >
                  Refresh
                </Button>
                {worktrees.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={pruneAll}
                    disabled={pruning}
                    className="text-destructive"
                  >
                    Prune all
                  </Button>
                )}
              </div>
            </div>
            {worktrees.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">
                No worktrees right now.
              </p>
            ) : (
              worktrees.map((wt) => (
                <div
                  key={wt.dir}
                  className="p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs truncate">{wt.dir}</div>
                    {wt.branch && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        branch: <code>{wt.branch}</code>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void pruneOne(wt)}
                    className="text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
