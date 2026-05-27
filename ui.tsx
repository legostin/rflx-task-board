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
import { TaskDetailPanel } from "./task-detail";
import { SettingsView } from "./settings";
import type { Task, TaskStatus, TaskType, TaskPriority } from "./actions/_types";
import {
  TASK_STATUSES,
  TASK_TYPES,
  TASK_PRIORITIES,
  TYPE_DEFAULTS,
} from "./actions/_types";

/**
 * Kanban board UI for the task-board utility. Reads tasks via
 * `reflex.kb.list({kind:"task"})` (and the matching `reflex.tasks.*`
 * helpers), renders columns with drag-drop, polls live status from the
 * bound topic when a card is in-progress.
 */

const COLUMNS: { id: TaskStatus; title: string }[] = [
  { id: "backlog", title: "Backlog" },
  { id: "ready", title: "Ready" },
  { id: "in-progress", title: "In progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
  { id: "blocked", title: "Blocked" },
];

type View =
  | { name: "board" }
  | { name: "detail"; taskId: string }
  | { name: "create" }
  | { name: "settings" };

const tasksApi = reflex.tasks as unknown as {
  list: () => Promise<{ tasks: Task[] }>;
  get: (a: { id: string }) => Promise<Task | null>;
  create: (a: Partial<Task>) => Promise<{ id: string }>;
  update: (a: { id: string; patch: Partial<Task> }) => Promise<{ ok: boolean }>;
  delete: (a: { id: string }) => Promise<{ ok: boolean }>;
  dispatch: (a: {
    id: string;
    harness?: string;
    model?: string;
  }) => Promise<
    | { ok: true; taskId: string; topicId: string; worktree?: { dir: string; branch: string } }
    | { ok: false; error: string }
  >;
  observe: (a: { id: string }) => Promise<{
    taskId: string;
    status: string;
    topicId: string | null;
    lastAssistantText: string | null;
    pending: Array<{ kind: string; summary: string; requestId: string }>;
    recentEvents: Array<{ ts: string; kind: string }>;
    topicEnded: boolean;
  } | null>;
  complete: (a: {
    id: string;
    outcome: "done" | "review" | "blocked";
  }) => Promise<{ ok: boolean }>;
};

const gitApi = reflex.git as unknown as {
  isRepo: () => Promise<{ ok: boolean }>;
  hasRemote: () => Promise<{ ok: boolean }>;
  hasGhCli: () => Promise<{ ok: boolean }>;
  worktree: {
    merge: (a: { branch: string }) => Promise<{ ok: boolean; error?: string; conflicts?: string[] }>;
    remove: (a: { slug: string; branch: string; force?: boolean }) => Promise<{ ok: boolean }>;
    list: () => Promise<{ worktrees: Array<{ dir: string; branch?: string }> }>;
  };
};

export default function TaskBoardApp() {
  const [view, setView] = useState<View>({ name: "board" });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await tasksApi.list();
    setTasks(res.tasks);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const moveTask = useCallback(
    async (taskId: string, nextStatus: TaskStatus) => {
      const t = tasks.find((x) => x.id === taskId);
      if (!t || t.status === nextStatus) return;
      // Optimistic.
      setTasks((cur) =>
        cur.map((x) => (x.id === taskId ? { ...x, status: nextStatus } : x)),
      );
      await tasksApi.update({ id: taskId, patch: { status: nextStatus } });
      void refresh();
    },
    [tasks, refresh],
  );

  if (view.name === "detail") {
    return (
      <TaskDetailPanel
        taskId={view.taskId}
        api={{ tasksApi, gitApi }}
        onBack={() => setView({ name: "board" })}
        onDeleted={() => {
          setView({ name: "board" });
          void refresh();
        }}
      />
    );
  }

  if (view.name === "create") {
    return (
      <CreateTaskView
        onCreated={(id) => {
          void refresh();
          setView({ name: "detail", taskId: id });
        }}
        onCancel={() => setView({ name: "board" })}
      />
    );
  }

  if (view.name === "settings") {
    return <SettingsView onClose={() => setView({ name: "board" })} />;
  }

  return (
    <div className="p-4 space-y-4 min-h-screen">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView({ name: "settings" })}
          >
            ⚙ Settings
          </Button>
          <Button onClick={() => setView({ name: "create" })}>+ New task</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 items-start">
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={tasks.filter((t) => t.status === col.id)}
              onDrop={(id) => void moveTask(id, col.id)}
              onOpen={(id) => setView({ name: "detail", taskId: id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Column({
  column,
  tasks,
  onDrop,
  onOpen,
}: {
  column: { id: TaskStatus; title: string };
  tasks: Task[];
  onDrop: (taskId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`rounded-lg border bg-muted/30 p-2 min-h-[200px] ${over ? "bg-violet-50/60" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/task");
        if (id) onDrop(id);
      }}
    >
      <div className="flex items-baseline justify-between px-1 py-1 mb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {column.title}
        </h2>
        <Badge variant="secondary" className="text-[10px]">
          {tasks.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onOpen={() => onOpen(t.id)} />
        ))}
        {tasks.length === 0 && (
          <p className="text-[10px] text-muted-foreground/50 text-center py-4">
            empty
          </p>
        )}
      </div>
    </div>
  );
}

const TYPE_COLOURS: Record<TaskType, string> = {
  feature: "text-emerald-700 bg-emerald-50 border-emerald-200",
  bug: "text-red-700 bg-red-50 border-red-200",
  refactor: "text-violet-700 bg-violet-50 border-violet-200",
  docs: "text-blue-700 bg-blue-50 border-blue-200",
  chore: "text-stone-700 bg-stone-50 border-stone-200",
  research: "text-amber-700 bg-amber-50 border-amber-200",
  review: "text-cyan-700 bg-cyan-50 border-cyan-200",
  call: "text-pink-700 bg-pink-50 border-pink-200",
  idea: "text-purple-700 bg-purple-50 border-purple-200",
};

function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const [live, setLive] = useState<{
    text: string | null;
    pending: number;
  } | null>(null);

  useEffect(() => {
    if (task.status !== "in-progress" || !task.topicId) return;
    let alive = true;
    const tick = async () => {
      const obs = await tasksApi.observe({ id: task.id });
      if (!alive || !obs) return;
      setLive({ text: obs.lastAssistantText, pending: obs.pending.length });
    };
    void tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [task.id, task.status, task.topicId]);

  const priorityChip =
    task.priority === "high" ? "🔥" : task.priority === "low" ? "🌱" : null;

  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow ${
        live?.pending && live.pending > 0 ? "ring-2 ring-red-400" : ""
      }`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/task", task.id)}
      onClick={onOpen}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <span
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${TYPE_COLOURS[task.type] ?? ""}`}
          >
            {task.type}
          </span>
          {priorityChip && <span className="text-xs">{priorityChip}</span>}
        </div>
        <div className="font-medium text-sm leading-snug line-clamp-2">
          {task.title}
        </div>
        {task.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.labels.slice(0, 3).map((l) => (
              <Badge key={l} variant="outline" className="text-[9px]">
                {l}
              </Badge>
            ))}
          </div>
        )}
        {live?.text && task.status === "in-progress" && (
          <p className="text-[11px] text-muted-foreground italic line-clamp-2 border-l-2 border-violet-300 pl-2">
            {live.text}
          </p>
        )}
        {live?.pending && live.pending > 0 ? (
          <p className="text-[11px] text-red-600 font-medium">
            ⚠ {live.pending} pending — needs your input
          </p>
        ) : null}
        {task.worktree && (
          <p className="text-[10px] font-mono text-muted-foreground truncate">
            {task.worktree.branch}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CreateTaskView({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<TaskType>("feature");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const res = await tasksApi.create({ title, body, type, priority } as Partial<Task>);
    setBusy(false);
    onCreated(res.id);
  };
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">New task</h1>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Title</label>
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Description (markdown)
        </label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Context, acceptance criteria, notes…"
          rows={8}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TaskType)}
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
          >
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t} {TYPE_DEFAULTS[t].isCode ? "(code)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy || !title.trim()}>
          {busy ? "Saving…" : "Create"}
        </Button>
      </div>
    </div>
  );
}
