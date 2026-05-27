import { useCallback, useEffect, useState } from "react";
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
import type {
  Task,
  TaskHookRef,
  TaskPriority,
  TaskStatus,
} from "./actions/_types";
import { TASK_STATUSES, TASK_PRIORITIES, TYPE_DEFAULTS } from "./actions/_types";

interface ApiBundle {
  tasksApi: {
    get: (a: { id: string }) => Promise<Task | null>;
    update: (a: { id: string; patch: Partial<Task> }) => Promise<{ ok: boolean }>;
    delete: (a: { id: string }) => Promise<{ ok: boolean }>;
    dispatch: (a: {
      id: string;
    }) => Promise<
      | { ok: true; taskId: string; topicId: string; worktree?: { dir: string; branch: string } }
      | { ok: false; error: string }
    >;
    observe: (a: { id: string }) => Promise<{
      status: string;
      topicId: string | null;
      lastAssistantText: string | null;
      pending: Array<{ kind: string; summary: string; requestId: string }>;
      topicEnded: boolean;
    } | null>;
    complete: (a: {
      id: string;
      outcome: "done" | "review" | "blocked";
    }) => Promise<{ ok: boolean }>;
  };
  gitApi: {
    isRepo: () => Promise<{ ok: boolean }>;
    hasRemote: () => Promise<{ ok: boolean }>;
    hasGhCli: () => Promise<{ ok: boolean }>;
    worktree: {
      merge: (a: { branch: string }) => Promise<{
        ok: boolean;
        error?: string;
        conflicts?: string[];
      }>;
      remove: (a: { slug: string; branch: string; force?: boolean }) => Promise<{
        ok: boolean;
      }>;
    };
  };
}

export function TaskDetailPanel({
  taskId,
  api,
  onBack,
  onDeleted,
}: {
  taskId: string;
  api: ApiBundle;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [live, setLive] = useState<{
    text: string | null;
    pending: number;
    topicId: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const t = await api.tasksApi.get({ id: taskId });
    setTask(t);
    if (t) {
      setTitleDraft(t.title);
      setBodyDraft(t.body);
    }
  }, [api.tasksApi, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!task?.topicId || task.status !== "in-progress") return;
    let alive = true;
    const tick = async () => {
      const obs = await api.tasksApi.observe({ id: taskId });
      if (!alive || !obs) return;
      setLive({
        text: obs.lastAssistantText,
        pending: obs.pending.length,
        topicId: obs.topicId,
      });
    };
    void tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [api.tasksApi, task?.topicId, task?.status, taskId]);

  if (!task) {
    return (
      <div className="p-4">
        <Button variant="ghost" onClick={onBack}>
          ← Board
        </Button>
        <p className="text-sm text-muted-foreground mt-4">Loading task…</p>
      </div>
    );
  }

  const isCode = TYPE_DEFAULTS[task.type].isCode;

  const updateField = async (patch: Partial<Task>) => {
    setBusy(true);
    await api.tasksApi.update({ id: task.id, patch });
    setBusy(false);
    void load();
  };

  const dispatch = async () => {
    setBusy(true);
    const res = await api.tasksApi.dispatch({ id: task.id });
    setBusy(false);
    if (!res.ok) {
      alert(res.error ?? "Dispatch failed");
      return;
    }
    void load();
  };

  const mergeOrPR = async () => {
    if (!task.worktree) return;
    setBusy(true);
    const merge = await api.gitApi.worktree.merge({ branch: task.worktree.branch });
    setBusy(false);
    if (!merge.ok) {
      alert(
        `Merge failed: ${merge.error ?? ""}\nConflicts:\n${(merge.conflicts ?? []).join("\n")}`,
      );
      return;
    }
    // Remove worktree after successful merge.
    await api.gitApi.worktree.remove({
      slug: task.id,
      branch: task.worktree.branch,
    });
    await api.tasksApi.update({
      id: task.id,
      patch: { worktree: null, status: "done" } as Partial<Task>,
    });
    void load();
  };

  const removeTask = async () => {
    if (!confirm(`Delete task "${task.title}"? This cannot be undone.`)) return;
    if (task.worktree) {
      await api.gitApi.worktree.remove({
        slug: task.id,
        branch: task.worktree.branch,
        force: true,
      });
    }
    await api.tasksApi.delete({ id: task.id });
    onDeleted();
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Board
        </Button>
        <div className="flex items-center gap-2">
          {task.status !== "in-progress" && (
            <Button onClick={dispatch} disabled={busy}>
              {isCode ? "Send to agent (new worktree)" : "Send to agent"}
            </Button>
          )}
          {task.worktree && task.status !== "in-progress" && (
            <Button variant="default" onClick={mergeOrPR} disabled={busy}>
              Merge {task.worktree.branch}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={removeTask} disabled={busy}>
            Delete
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-2">
            <CardTitle className="text-xl">
              {editing ? (
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="text-xl font-semibold"
                />
              ) : (
                task.title
              )}
            </CardTitle>
            <Badge variant="outline" className="text-[10px] uppercase">
              {task.type}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>id: <code>{task.id}</code></span>
            <span>created {new Date(task.createdAt).toLocaleDateString()}</span>
            {task.worktree && (
              <span className="font-mono">{task.worktree.branch}</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Status
              </label>
              <select
                value={task.status}
                onChange={(e) => void updateField({ status: e.target.value as TaskStatus })}
                className="w-full mt-1 border rounded-md px-2 py-1 text-sm bg-background"
                disabled={busy}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Priority
              </label>
              <select
                value={task.priority}
                onChange={(e) =>
                  void updateField({ priority: e.target.value as TaskPriority })
                }
                className="w-full mt-1 border rounded-md px-2 py-1 text-sm bg-background"
                disabled={busy}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Assignee
              </label>
              <Input
                value={task.assignee ?? ""}
                onChange={(e) =>
                  void updateField({ assignee: e.target.value || null })
                }
                placeholder="agent / your name"
                disabled={busy}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Description
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (editing) {
                    void updateField({ title: titleDraft, body: bodyDraft });
                  }
                  setEditing((v) => !v);
                }}
              >
                {editing ? "Save" : "Edit"}
              </Button>
            </div>
            {editing ? (
              <Textarea
                value={bodyDraft}
                onChange={(e) => setBodyDraft(e.target.value)}
                rows={10}
                className="mt-1 font-mono text-xs"
              />
            ) : (
              <pre className="mt-1 whitespace-pre-wrap text-sm">
                {task.body || "(empty)"}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      <HooksEditor
        task={task}
        onUpdate={(patch) => void updateField(patch)}
      />

      {task.status === "in-progress" && task.topicId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Agent live status</CardTitle>
          </CardHeader>
          <CardContent>
            {live?.text ? (
              <p className="text-sm italic border-l-2 border-violet-300 pl-3">
                {live.text}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Connecting…</p>
            )}
            {live?.pending && live.pending > 0 ? (
              <p className="text-sm text-red-600 mt-2 font-medium">
                ⚠ Agent needs your input ({live.pending} pending). Open the
                topic to respond.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground mt-2">
              Topic id: <code>{task.topicId}</code>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface WorkflowSummary {
  id: string;
  label: string;
  description?: string;
  trigger?: string;
  stepCount?: number;
}

const workflowApi = reflex.workflow as unknown as {
  list: () => Promise<WorkflowSummary[]>;
};

function HooksEditor({
  task,
  onUpdate,
}: {
  task: Task;
  onUpdate: (patch: Partial<Task>) => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const wfs = await workflowApi.list().catch(() => []);
      if (alive) setWorkflows(wfs);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Lifecycle hooks</CardTitle>
        <p className="text-xs text-muted-foreground">
          Run a workflow (or inject a chat prompt) before the agent starts the
          task, or after they finish. E.g. "regenerate API docs" as a{" "}
          <code>post</code> workflow, or "draft an agenda" as a <code>pre</code>{" "}
          chat prompt for a meeting.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <HookGroup
          label="Before agent starts (pre)"
          hooks={task.pre}
          workflows={workflows}
          onChange={(next) => onUpdate({ pre: next })}
        />
        <HookGroup
          label="After agent finishes (post)"
          hooks={task.post}
          workflows={workflows}
          onChange={(next) => onUpdate({ post: next })}
        />
      </CardContent>
    </Card>
  );
}

function HookGroup({
  label,
  hooks,
  workflows,
  onChange,
}: {
  label: string;
  hooks: TaskHookRef[];
  workflows: WorkflowSummary[];
  onChange: (next: TaskHookRef[]) => void;
}) {
  const [picker, setPicker] = useState<"workflow" | "chat" | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [wfChoice, setWfChoice] = useState<string>("");

  const add = (hook: TaskHookRef) => onChange([...hooks, hook]);
  const removeAt = (i: number) =>
    onChange(hooks.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPicker("workflow");
              setWfChoice(workflows[0]?.id ?? "");
            }}
          >
            + Workflow
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPicker("chat")}
          >
            + Chat prompt
          </Button>
        </div>
      </div>

      {hooks.length === 0 && picker === null && (
        <p className="text-[11px] text-muted-foreground italic">
          No hooks set.
        </p>
      )}

      <div className="space-y-1">
        {hooks.map((h, i) => (
          <div
            key={`${h.kind}:${i}`}
            className="flex items-start gap-2 p-2 border rounded-md bg-muted/30"
          >
            <Badge variant="outline" className="text-[9px] mt-0.5">
              {h.kind}
            </Badge>
            <div className="flex-1 min-w-0 text-xs">
              {h.kind === "workflow"
                ? `Run workflow: ${h.id}`
                : h.prompt}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeAt(i)}
              className="h-6 px-2 text-destructive"
            >
              ×
            </Button>
          </div>
        ))}
      </div>

      {picker === "workflow" && (
        <div className="flex items-center gap-2 p-2 border rounded-md">
          {workflows.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              No workflows in this project yet — create one first (
              <code>/workflow</code>).
            </span>
          ) : (
            <>
              <select
                value={wfChoice}
                onChange={(e) => setWfChoice(e.target.value)}
                className="flex-1 border rounded-md px-2 py-1 text-xs bg-background"
              >
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} ({w.id})
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => {
                  if (wfChoice) add({ kind: "workflow", id: wfChoice });
                  setPicker(null);
                }}
              >
                Add
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPicker(null)}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
        </div>
      )}

      {picker === "chat" && (
        <div className="space-y-2 p-2 border rounded-md">
          <Textarea
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            placeholder="Markdown prepended to the agent's first message. E.g. 'Draft an agenda for tomorrow's meeting based on these talking points: …'"
            rows={4}
            className="text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPicker(null);
                setChatDraft("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const t = chatDraft.trim();
                if (t) add({ kind: "chat", prompt: t });
                setChatDraft("");
                setPicker(null);
              }}
              disabled={!chatDraft.trim()}
            >
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
