"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Status = "todo" | "doing" | "done" | "stuck" | "waiting" | "dropped";
type DayPart = "morning" | "afternoon" | "evening";
type ValueGroup = "Doanh thu" | "Khách hàng" | "Chiến lược" | "Vận hành" | "Cá nhân" | "Khác";
type FocusTimerStatus = "idle" | "running" | "paused" | "expired" | "completed";

type Subtask = { id: string; title: string; completed: boolean; createdAt: string };
type FocusSession = {
  id: string;
  taskId: string;
  startedAt: string;
  pausedAt: string | null;
  endedAt: string;
  durationSeconds: number;
  endReason: "completed" | "paused" | "stuck" | "abandoned" | "switched_task";
};

type RescheduleRecord = {
  oldDate: string | null;
  oldTime: string | null;
  newDate: string | null;
  newTime: string | null;
  changedAt: string;
};

type Task = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  plannedDate: string | null;
  dayPart: DayPart | null;
  startTime: string | null;
  durationMinutes: number;
  isMustWin: boolean;
  valueGroup: ValueGroup;
  desiredOutcome: string;
  firstStep: string;
  notes: string;
  status: Status;
  completedAt: string | null;
  stuckReason: string;
  waitingFor: string;
  subtasks: Subtask[];
  source: "quick_add" | "schedule_modal" | "sample_data" | "backlog" | "rescue" | "end_day";
  assignedTo: string | null;
  workspaceId: string | null;
  bcmLink: string | null;
  archivedAt: string | null;
  focusTimerStatus: FocusTimerStatus;
  focusStartedAt: string | null;
  focusLastStartedAt: string | null;
  focusPausedAt: string | null;
  focusCompletedAt: string | null;
  focusAccumulatedSeconds: number;
  focusDurationSeconds: number;
  focusSessions: FocusSession[];
  stuckDetails: string;
  minimumVersion: string;
  missingInfoItems: string[];
  followUpAt: string | null;
  rescheduleCount: number;
  rescheduleHistory: RescheduleRecord[];
  lastRescheduledAt: string | null;
  attentionSnoozedUntil: string | null;
};

type ScheduleDraft = {
  taskId: string;
  dateMode: "today" | "tomorrow" | "monday" | "custom";
  customDate: string;
  dayPart: DayPart;
  time: string;
  duration: number;
  valueGroup: ValueGroup;
  isMustWin: boolean;
};

const STORAGE_KEY = "personal-work-os:v1:tasks";
const ENERGY_KEY = "personal-work-os:v1:energy";
const END_DAY_KEY = "personal-work-os:v2:end-day";
const COPY = {
  attentionTitle: "Cần chú ý",
  attentionIntro: "Những việc này không cần thêm áp lực, chỉ cần một quyết định rõ.",
  noAttention: "Không có việc nào cần chú ý lúc này.",
  emptyDay: "Hôm nay chưa có việc nào được cam kết.",
  emptyWeek: "Tuần này còn nhiều khoảng trống.",
  emptyMonth: "Tháng này chưa có việc nào được đặt lịch.",
  emptyBacklog: "Không có việc nào đang trôi. Nhẹ hơn một chút rồi.",
  saved: "Đã lưu thay đổi.",
  completed: "Xong việc này rồi. Nhẹ hơn một chút.",
  waiting: "Đang chờ cũng là một trạng thái hợp lệ.",
};
const STATUS_LABEL: Record<Status, string> = {
  todo: "Cần làm",
  doing: "Đang làm",
  done: "Hoàn thành",
  stuck: "Bị kẹt",
  waiting: "Đang chờ",
  dropped: "Đã bỏ",
};

function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function addDays(base: string, days: number) {
  const date = new Date(`${base}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function nextMonday(base: string) {
  const date = new Date(`${base}T12:00:00`);
  const distance = ((8 - date.getDay()) % 7) || 7;
  return addDays(base, distance);
}

function partFromTime(time: string): DayPart {
  const hour = Number(time.split(":")[0]);
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function currentPart(): DayPart {
  return partFromTime(`${String(new Date().getHours()).padStart(2, "0")}:00`);
}

function greeting() {
  const part = currentPart();
  if (part === "morning") return "Chào buổi sáng";
  if (part === "afternoon") return "Chào buổi chiều";
  return "Chào buổi tối";
}

function makeId(prefix = "item") {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function focusDefaults(durationMinutes = 25) {
  return {
    focusTimerStatus: "idle" as FocusTimerStatus,
    focusStartedAt: null,
    focusLastStartedAt: null,
    focusPausedAt: null,
    focusCompletedAt: null,
    focusAccumulatedSeconds: 0,
    focusDurationSeconds: (durationMinutes || 25) * 60,
    focusSessions: [] as FocusSession[],
    stuckDetails: "",
    minimumVersion: "",
    missingInfoItems: [] as string[],
    followUpAt: null,
  };
}

function normalizeTask(raw: Partial<Task> & Pick<Task, "id" | "title">): Task {
  const durationMinutes = raw.durationMinutes || 25;
  const now = new Date().toISOString();
  const legacySubtasks = Array.isArray(raw.subtasks) ? raw.subtasks : [];
  const subtasks = legacySubtasks.map((item) => typeof item === "string"
    ? { id: makeId("subtask"), title: item, completed: false, createdAt: now }
    : item).filter((item) => item?.title);
  return {
    id: raw.id,
    title: raw.title,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    plannedDate: raw.plannedDate || null,
    dayPart: raw.dayPart || null,
    startTime: raw.startTime || null,
    durationMinutes,
    isMustWin: Boolean(raw.isMustWin),
    valueGroup: raw.valueGroup || "Khác",
    desiredOutcome: raw.desiredOutcome || "",
    firstStep: raw.firstStep || "",
    notes: raw.notes || "",
    status: raw.status || "todo",
    completedAt: raw.completedAt || null,
    stuckReason: raw.stuckReason || "",
    waitingFor: raw.waitingFor || "",
    subtasks,
    source: raw.source || "backlog",
    assignedTo: raw.assignedTo || null,
    workspaceId: raw.workspaceId || null,
    bcmLink: raw.bcmLink || null,
    archivedAt: raw.archivedAt || null,
    ...focusDefaults(durationMinutes),
    focusTimerStatus: raw.focusTimerStatus || (raw.status === "done" ? "completed" : "idle"),
    focusStartedAt: raw.focusStartedAt || null,
    focusLastStartedAt: raw.focusLastStartedAt || null,
    focusPausedAt: raw.focusPausedAt || null,
    focusCompletedAt: raw.focusCompletedAt || null,
    focusAccumulatedSeconds: Number(raw.focusAccumulatedSeconds || 0),
    focusDurationSeconds: Number(raw.focusDurationSeconds || durationMinutes * 60),
    focusSessions: Array.isArray(raw.focusSessions) ? raw.focusSessions : [],
    stuckDetails: raw.stuckDetails || "",
    minimumVersion: raw.minimumVersion || "",
    missingInfoItems: Array.isArray(raw.missingInfoItems) ? raw.missingInfoItems : [],
    followUpAt: raw.followUpAt || null,
    rescheduleCount: Number(raw.rescheduleCount || 0),
    rescheduleHistory: Array.isArray(raw.rescheduleHistory) ? raw.rescheduleHistory : [],
    lastRescheduledAt: raw.lastRescheduledAt || null,
    attentionSnoozedUntil: raw.attentionSnoozedUntil || null,
  };
}

function makeFocusSession(task: Task, durationSeconds: number, endReason: FocusSession["endReason"], endedAt = new Date().toISOString()): FocusSession {
  return {
    id: makeId("focus"),
    taskId: task.id,
    startedAt: task.focusLastStartedAt || task.focusStartedAt || endedAt,
    pausedAt: endReason === "paused" || endReason === "stuck" ? endedAt : null,
    endedAt,
    durationSeconds: Math.max(0, durationSeconds),
    endReason,
  };
}

function liveAccumulated(task: Task, at = Date.now()) {
  const runningSeconds = task.focusTimerStatus === "running" && task.focusLastStartedAt
    ? Math.max(0, Math.floor((at - new Date(task.focusLastStartedAt).getTime()) / 1000))
    : 0;
  return task.focusAccumulatedSeconds + runningSeconds;
}

function seedTasks(today: string): Task[] {
  const now = new Date().toISOString();
  const task = (data: Partial<Task> & Pick<Task, "id" | "title">): Task => {
    const { id, title, ...overrides } = data;
    return ({
    id,
    title,
    createdAt: now,
    updatedAt: now,
    plannedDate: null,
    dayPart: null,
    startTime: null,
    durationMinutes: 25,
    isMustWin: false,
    valueGroup: "Khác",
    desiredOutcome: "",
    firstStep: "",
    notes: "",
    status: "todo",
    completedAt: null,
    stuckReason: "",
    waitingFor: "",
    subtasks: [],
    source: "sample_data",
    assignedTo: null,
    workspaceId: null,
    bcmLink: null,
    archivedAt: null,
    ...focusDefaults(data.durationMinutes || 25),
    rescheduleCount: 0,
    rescheduleHistory: [],
    lastRescheduledAt: null,
    attentionSnoozedUntil: null,
    ...overrides,
  });
  };
  return [
    task({ id: "sample-proposal", title: "Hoàn thiện proposal gửi anh Nam", plannedDate: today, dayPart: "afternoon", startTime: "16:00", durationMinutes: 45, isMustWin: true, valueGroup: "Doanh thu", desiredOutcome: "Proposal đủ rõ để anh Nam phản hồi hoặc chốt bước tiếp theo.", firstStep: "Mở bản nháp và rà lại phạm vi công việc." }),
    task({ id: "sample-linh", title: "Gọi chị Linh về gói tư vấn", plannedDate: today, dayPart: "afternoon", startTime: "14:00", valueGroup: "Khách hàng" }),
    task({ id: "sample-followup", title: "Follow-up khách đã nhận báo giá", valueGroup: "Doanh thu" }),
    task({ id: "sample-course", title: "Chuẩn bị nội dung khóa học thứ Bảy", plannedDate: today, dayPart: "morning", startTime: "10:30", durationMinutes: 90, valueGroup: "Chiến lược", status: "stuck", stuckReason: "Chưa có đủ outline cuối cùng." }),
    task({ id: "sample-minh", title: "Gọi anh Minh", plannedDate: today, dayPart: "morning", startTime: "09:00", durationMinutes: 15, valueGroup: "Khách hàng", status: "done", completedAt: now }),
  ];
}

function formatDate(dateString: string) {
  const date = new Date(`${dateString}T12:00:00`);
  const value = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

export default function PersonalWorkOS({ view = "day" }: { view?: "day" | "week" | "backlog" | "focus" }) {
  const actualToday = useMemo(() => localDate(), []);
  const [selectedDate, setSelectedDate] = useState(actualToday);
  const today = selectedDate;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [toast, setToast] = useState<{ message: string; taskId?: string; undoTask?: Task } | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDraft | null>(null);
  const [energy, setEnergy] = useState<"Thấp" | "Vừa" | "Tốt">("Vừa");
  const [expanded, setExpanded] = useState<Record<DayPart, boolean>>({ morning: true, afternoon: true, evening: true });
  const [endDayOpen, setEndDayOpen] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState("");
  const [switchTask, setSwitchTask] = useState<Task | null>(null);
  const [rescueTaskId, setRescueTaskId] = useState("");
  const [waitingTaskId, setWaitingTaskId] = useState("");
  const [laterTaskId, setLaterTaskId] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect -- client storage hydration is intentionally performed once after mount */
  useEffect(() => {
    const queryDate = new URLSearchParams(window.location.search).get("date");
    const queryTask = new URLSearchParams(window.location.search).get("task");
    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) setSelectedDate(queryDate);
    if (queryTask) setFocusTaskId(queryTask);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial = (stored ? (JSON.parse(stored) as Task[]) : seedTasks(actualToday)).map((task) => normalizeTask(task));
    setTasks(initial);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    const energyMap = JSON.parse(window.localStorage.getItem(ENERGY_KEY) || "{}");
    setEnergy(energyMap[queryDate || actualToday] || "Vừa");
    setLoaded(true);
  }, [actualToday]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (loaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks, loaded]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const mutateTasks = (mutator: (current: Task[]) => Task[]) => {
    const next = mutator(tasks);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setTasks(next);
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    mutateTasks((current) => current.map((task) => task.id === id ? { ...task, ...updates, updatedAt: new Date().toISOString() } : task));
  };

  const addTask = (event?: FormEvent) => {
    event?.preventDefault();
    const title = quickTitle.trim();
    if (!title) {
      setInputMessage("Bạn muốn đưa việc gì ra khỏi đầu?");
      return;
    }
    if (title.length < 5 || !/[a-zA-ZÀ-ỹ]/.test(title)) {
      setInputMessage("Viết rõ hơn một chút để lát nữa bạn còn biết cần làm gì.");
      return;
    }
    const now = new Date().toISOString();
    const newTask: Task = {
      id: makeId("task"), title, createdAt: now, updatedAt: now, plannedDate: null, dayPart: null, startTime: null,
      durationMinutes: 25, isMustWin: false, valueGroup: "Khác", desiredOutcome: "", firstStep: "", notes: "", status: "todo",
      completedAt: null, stuckReason: "", waitingFor: "", subtasks: [], source: "quick_add", assignedTo: null, workspaceId: null,
      bcmLink: null, archivedAt: null, ...focusDefaults(25), rescheduleCount: 0, rescheduleHistory: [], lastRescheduledAt: null, attentionSnoozedUntil: null,
    };
    mutateTasks((current) => [newTask, ...current]);
    setQuickTitle("");
    setInputMessage("");
    setToast({ message: "Đã lưu việc này.", taskId: newTask.id });
  };

  const openSchedule = (task: Task, mustWin = false) => {
    const part = task.dayPart || currentPart();
    const defaults: Record<DayPart, string> = { morning: "09:00", afternoon: "14:00", evening: "20:00" };
    let dateMode: ScheduleDraft["dateMode"] = "today";
    if (task.plannedDate === addDays(today, 1)) dateMode = "tomorrow";
    else if (task.plannedDate && task.plannedDate !== today) dateMode = "custom";
    setSchedule({ taskId: task.id, dateMode, customDate: task.plannedDate || today, dayPart: part, time: task.startTime || defaults[part], duration: task.durationMinutes || 25, valueGroup: task.valueGroup || "Khác", isMustWin: mustWin || task.isMustWin });
  };

  const resolveScheduleDate = (draft: ScheduleDraft) => {
    if (draft.dateMode === "today") return today;
    if (draft.dateMode === "tomorrow") return addDays(today, 1);
    if (draft.dateMode === "monday") return nextMonday(today);
    return draft.customDate;
  };

  const commitSchedule = () => {
    if (!schedule || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) return;
    const plannedDate = resolveScheduleDate(schedule);
    const changedAt = new Date().toISOString();
    mutateTasks((current) => current.map((task) => {
      if (task.id === schedule.taskId) {
        const changed = task.plannedDate !== plannedDate || task.startTime !== schedule.time;
        const wasScheduled = Boolean(task.plannedDate || task.startTime);
        const record: RescheduleRecord = { oldDate: task.plannedDate, oldTime: task.startTime, newDate: plannedDate, newTime: schedule.time, changedAt };
        return { ...task, plannedDate, dayPart: partFromTime(schedule.time), startTime: schedule.time, durationMinutes: schedule.duration, valueGroup: schedule.valueGroup, isMustWin: schedule.isMustWin, updatedAt: changedAt, source: "schedule_modal", rescheduleCount: task.rescheduleCount + (changed && wasScheduled ? 1 : 0), rescheduleHistory: changed && wasScheduled ? [...task.rescheduleHistory, record] : task.rescheduleHistory, lastRescheduledAt: changed && wasScheduled ? changedAt : task.lastRescheduledAt };
      }
      if (schedule.isMustWin && task.plannedDate === plannedDate) return { ...task, isMustWin: false, updatedAt: new Date().toISOString() };
      return task;
    }));
    const when = plannedDate === today ? "hôm nay" : plannedDate === addDays(today, 1) ? "ngày mai" : formatDate(plannedDate);
    setToast({ message: `Đã đặt việc này vào ${when} lúc ${schedule.time}.` });
    setSchedule(null);
  };

  const activateFocus = (task: Task) => {
    const now = new Date().toISOString();
    const running = tasks.find((item) => item.status === "doing" && item.id !== task.id);
    mutateTasks((current) => current.map((item) => {
      if (item.id === task.id) return {
        ...item,
        status: "doing",
        focusTimerStatus: item.focusTimerStatus === "completed" ? "idle" : item.focusTimerStatus,
        focusDurationSeconds: item.focusDurationSeconds || (item.durationMinutes || 25) * 60,
        updatedAt: now,
      };
      if (running && item.id === running.id) {
        const sessionSeconds = item.focusTimerStatus === "running" && item.focusLastStartedAt
          ? Math.max(0, Math.floor((Date.now() - new Date(item.focusLastStartedAt).getTime()) / 1000)) : 0;
        return {
          ...item,
          status: "todo",
          focusTimerStatus: "paused",
          focusAccumulatedSeconds: item.focusAccumulatedSeconds + sessionSeconds,
          focusLastStartedAt: null,
          focusPausedAt: now,
          focusSessions: sessionSeconds ? [...item.focusSessions, makeFocusSession(item, sessionSeconds, "switched_task", now)] : item.focusSessions,
          updatedAt: now,
        };
      }
      return item;
    }));
    window.location.href = `/admin/focus?task=${encodeURIComponent(task.id)}`;
  };

  const startTask = (task: Task) => {
    const running = tasks.find((item) => item.status === "doing" && item.id !== task.id);
    if (running) {
      setSwitchTask(task);
      return;
    }
    activateFocus(task);
  };

  const completeTask = (task: Task) => {
    updateTask(task.id, { status: "done", completedAt: new Date().toISOString() });
    setToast({ message: task.isMustWin ? "Bạn đã thắng việc quan trọng nhất hôm nay." : COPY.completed });
  };

  const markStuck = (task: Task) => {
    setRescueTaskId(task.id);
  };

  const dropTask = (task: Task) => {
    if (!window.confirm(`Để “${task.title}” sang trạng thái Đã bỏ? Việc vẫn được giữ trong Backlog.`)) return;
    updateTask(task.id, { status: "dropped", isMustWin: false, archivedAt: new Date().toISOString() });
    setToast({ message: "Đã bỏ việc này.", undoTask: task });
  };

  const setWaiting = (task: Task) => setWaitingTaskId(task.id);
  const setLater = (task: Task) => setLaterTaskId(task.id);

  const addTaskForDate = (title: string, date: string) => {
    const clean = title.trim();
    if (!clean) return;
    const created = normalizeTask({ id: makeId("task"), title: clean, plannedDate: date, source: "backlog" });
    mutateTasks((current) => [created, ...current]);
    setToast({ message: `Đã thêm việc vào ${formatDate(date)}.` });
  };

  const undoAdded = (id: string) => {
    mutateTasks((current) => current.filter((task) => task.id !== id));
    setToast({ message: "Đã hoàn tác." });
  };

  const chooseMustWin = (task: Task) => {
    const date = task.plannedDate || today;
    mutateTasks((current) => current.map((item) => item.id === task.id
      ? { ...item, plannedDate: date, isMustWin: true, updatedAt: new Date().toISOString() }
      : item.plannedDate === date ? { ...item, isMustWin: false, updatedAt: new Date().toISOString() } : item));
    setToast({ message: task.plannedDate === date && tasks.some((item) => item.id !== task.id && item.isMustWin && item.plannedDate === date) ? "Đã thay việc phải thắng hôm nay." : "Đã chọn việc này là việc phải thắng hôm nay." });
  };

  const editTask = (task: Task) => {
    const title = window.prompt("Chỉnh tên việc", task.title)?.trim();
    if (!title) return;
    updateTask(task.id, { title });
    setToast({ message: "Đã cập nhật việc này." });
  };

  const restoreTask = (task: Task) => {
    updateTask(task.id, { status: "todo", archivedAt: null });
    setToast({ message: "Đã đưa việc này trở lại Backlog." });
  };

  const todayTasks = tasks.filter((task) => task.plannedDate === today && task.status !== "dropped");
  const scheduledToday = todayTasks.filter((task) => task.startTime);
  const mustWin = todayTasks.find((task) => task.isMustWin);
  const totalMinutes = scheduledToday.filter((task) => task.status !== "done").reduce((sum, task) => sum + task.durationMinutes, 0);

  const reminder = mustWin
    ? "Việc quan trọng đã có chỗ trong ngày. Giờ chỉ cần đi từng bước."
    : "Hôm nay chỉ cần chọn một việc quan trọng nhất.";

  const partInfo: Array<{ key: DayPart; label: string; range: string }> = [
    { key: "morning", label: "Sáng", range: "05:00–11:59" },
    { key: "afternoon", label: "Chiều", range: "12:00–17:59" },
    { key: "evening", label: "Tối", range: "18:00–23:59" },
  ];

  if (!loaded) return <div className="loading-page">Đang mở ngày làm việc của bạn…</div>;

  return (
    <div className={`app-shell ${view === "focus" ? "focus-shell" : ""}`}>
      {view !== "focus" && <aside className="sidebar">
        <a className="brand" href="/admin/ngay-cua-toi" aria-label="Personal Work OS">
          <span className="brand-mark">1</span>
          <span><strong>Personal Work OS</strong><small>Một ngày thật rõ</small></span>
        </a>
        <nav aria-label="Điều hướng chính">
          <a className={`nav-link ${view === "day" ? "active" : ""}`} href="/admin/ngay-cua-toi"><span className="nav-icon">◷</span>Ngày của tôi</a>
          <a className={`nav-link ${view === "week" ? "active" : ""}`} href="/admin/tuan-nay"><span className="nav-icon">▦</span>Tuần này</a>
          <a className={`nav-link ${view === "backlog" ? "active" : ""}`} href="/admin/backlog"><span className="nav-icon">≡</span>Lịch & Backlog</a>
        </nav>
        <div className="sidebar-quote"><span>“</span><p>Một việc đúng.<br />Một thời điểm thật.<br />Làm đến cùng.</p></div>
        <div className="profile"><span className="avatar">TL</span><span><strong>Thảo Lê</strong><small>Không gian cá nhân</small></span></div>
      </aside>}

      <main className={`main-content view-${view}`}>
        {view === "focus" ? <FocusMode task={tasks.find((task) => task.id === focusTaskId)} tasks={tasks} mutateTasks={mutateTasks} updateTask={updateTask} onSchedule={openSchedule} onOpenEndDay={() => setEndDayOpen(true)} actualToday={actualToday} /> : view === "day" ? <>
        <header className="topbar">
          <div><span className="mobile-brand">PERSONAL WORK OS</span><p>{today === actualToday ? "Hôm nay" : "Đang xem"} · {formatDate(today)}</p><h1>{today === actualToday ? greeting() : "Ngày của tôi"}</h1><p className="gentle-copy">{reminder}</p>{today !== actualToday && <a className="back-today" href="/admin/ngay-cua-toi">← Quay về hôm nay</a>}</div>
          <div className="day-settings">
            <div><span>Dự kiến tập trung</span><strong>{totalMinutes ? formatDuration(totalMinutes) : "chưa có"}</strong></div>
            <fieldset><legend>Năng lượng hôm nay</legend>{(["Thấp", "Vừa", "Tốt"] as const).map((level) => <button key={level} type="button" className={energy === level ? "selected" : ""} onClick={() => { setEnergy(level); const map = JSON.parse(localStorage.getItem(ENERGY_KEY) || "{}"); map[today] = level; localStorage.setItem(ENERGY_KEY, JSON.stringify(map)); }}>{level}</button>)}</fieldset>
          </div>
        </header>

        <form className="quick-add" onSubmit={addTask}>
          <label htmlFor="quick-task">Bạn đang cần làm việc gì?</label>
          <div><input id="quick-task" value={quickTitle} onChange={(event) => { setQuickTitle(event.target.value); setInputMessage(""); }} placeholder="Ví dụ: Gọi chị Linh lúc 3 giờ chiều" autoComplete="off" /><button type="submit">Thêm việc <span>↵</span></button></div>
          {inputMessage && <p className="input-message">{inputMessage}</p>}
        </form>

        <section className="must-win-section" aria-labelledby="must-win-title">
          <div className="section-kicker"><span className="kicker-dot" /><span id="must-win-title">Việc phải thắng hôm nay</span><span className="single-rule">Chỉ một việc</span></div>
          {mustWin ? (
            <article className={`must-win-card status-${mustWin.status}`}>
              <div className="win-copy">
                <span className="value-chip" data-group={mustWin.valueGroup}>{mustWin.valueGroup}</span>
                <h2>{mustWin.title}</h2>
                <p className="commitment">{mustWin.startTime ? `Đã cam kết lúc ${mustWin.startTime} · ${formatDuration(mustWin.durationMinutes)}` : "Chưa cam kết giờ"}</p>
                {mustWin.desiredOutcome && <p><span>Kết quả cần đạt</span>{mustWin.desiredOutcome}</p>}
                {mustWin.firstStep && <p><span>Bước đầu tiên</span>{mustWin.firstStep}</p>}
                {mustWin.status === "stuck" && <p className="stuck-note"><span>Đang bị kẹt</span>{mustWin.stuckReason || "Chưa ghi lý do."}</p>}
                {mustWin.status === "done" && <div className="win-done">✓ Đã thắng hôm nay</div>}
              </div>
              <div className="card-actions">
                {!mustWin.startTime && <button className="primary" onClick={() => openSchedule(mustWin, true)}>Đặt vào lịch</button>}
                {mustWin.startTime && mustWin.status === "todo" && <button className="primary" onClick={() => startTask(mustWin)}>Bắt đầu</button>}
                {mustWin.status === "doing" && <button className="primary" onClick={() => startTask(mustWin)}>Tiếp tục Focus</button>}
                {mustWin.status !== "done" && <button onClick={() => openSchedule(mustWin, true)}>{mustWin.startTime ? "Đổi giờ" : "Chọn giờ"}</button>}
                {mustWin.status !== "done" && <button onClick={() => markStuck(mustWin)}>Bị kẹt</button>}
                {mustWin.status !== "done" && <button className="quiet-danger" onClick={() => dropTask(mustWin)}>Bỏ việc</button>}
              </div>
            </article>
          ) : (
            <div className="empty-win"><div className="empty-symbol">◎</div><div><h2>Chưa chọn việc phải thắng hôm nay.</h2><p>Một ngày chỉ cần một việc thật sự đáng thắng.</p></div><button onClick={() => document.getElementById("quick-task")?.focus()}>Thêm việc mới</button></div>
          )}
        </section>

        <section className="day-plan" aria-labelledby="day-plan-title">
          <div className="section-heading"><div><span>LỊCH HÔM NAY</span><h2 id="day-plan-title">Sáng, chiều, tối</h2></div><p>Chỉ những việc đã có giờ thật.</p></div>
          <div className="day-parts">
            {partInfo.map((part) => {
              const partTasks = scheduledToday.filter((task) => task.dayPart === part.key).sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
              const current = currentPart() === part.key;
              const doneCount = partTasks.filter((task) => task.status === "done").length;
              return <article className={`day-part ${current ? "current" : ""}`} key={part.key}>
                <button className="day-part-head" onClick={() => setExpanded((value) => ({ ...value, [part.key]: !value[part.key] }))} aria-expanded={expanded[part.key]}>
                  <div><span className="part-orb" /><span><strong>{part.label}</strong><small>{part.range}</small></span>{current && <em>Đang diễn ra</em>}</div>
                  <span>{partTasks.length ? `${doneCount}/${partTasks.length} đã xong` : "Đang trống"}　{expanded[part.key] ? "⌃" : "⌄"}</span>
                </button>
                {expanded[part.key] && <div className="task-list">
                  {partTasks.length ? partTasks.map((task) => <TaskRow key={task.id} task={task} onStart={startTask} onComplete={completeTask} onSchedule={openSchedule} onStuck={markStuck} onDrop={dropTask} />) : <div className="empty-part"><p>Khoảng này đang trống.</p><button onClick={() => document.getElementById("quick-task")?.focus()}>+ Thêm một việc</button></div>}
                </div>}
              </article>;
            })}
          </div>
        </section>
        <section className="day-navigation" aria-label="Điều hướng ngày">
          <a href="/admin/tuan-nay"><span>▦</span><strong>Xem tuần này</strong><small>Bảy ngày trong một nhịp</small></a>
          <a href="/admin/backlog"><span>≡</span><strong>Xem tất cả công việc</strong><small>Tìm, lọc và sắp lịch</small></a>
          <button className={currentPart() === "evening" ? "prominent" : ""} onClick={() => setEndDayOpen(true)}><span>✓</span><strong>Kết ngày</strong><small>Nhìn lại thật nhẹ</small></button>
        </section>
        </> : view === "week" ? <WeekView tasks={tasks} actualToday={actualToday} /> : <BacklogView tasks={tasks} actualToday={actualToday} onSchedule={openSchedule} onStart={startTask} onComplete={completeTask} onStuck={markStuck} onWaiting={setWaiting} onLater={setLater} onDrop={dropTask} onEdit={editTask} onMustWin={chooseMustWin} onRestore={restoreTask} onUpdate={updateTask} onAddForDate={addTaskForDate} />}
      </main>

      {toast && <div className="toast" role="status"><span>✓</span><p>{toast.message}</p>{toast.taskId && <><button onClick={() => { const task = tasks.find((item) => item.id === toast.taskId); if (task) openSchedule(task); }}>Đặt vào lịch</button><button onClick={() => undoAdded(toast.taskId!)}>Hoàn tác</button></>}{toast.undoTask && <button onClick={() => { const prior = toast.undoTask!; updateTask(prior.id, { status: prior.status, isMustWin: prior.isMustWin, archivedAt: prior.archivedAt }); setToast({ message: "Đã hoàn tác." }); }}>Hoàn tác</button>}</div>}

      {schedule && <SchedulePanel draft={schedule} task={tasks.find((task) => task.id === schedule.taskId)!} today={today} onChange={setSchedule} onClose={() => setSchedule(null)} onCommit={commitSchedule} existingMustWin={tasks.some((task) => task.id !== schedule.taskId && task.isMustWin && task.plannedDate === resolveScheduleDate(schedule))} />}
      {rescueTaskId && tasks.find((task) => task.id === rescueTaskId) && <RescueModal task={tasks.find((task) => task.id === rescueTaskId)!} tasks={tasks} mutateTasks={mutateTasks} updateTask={updateTask} onClose={() => setRescueTaskId("")} onSchedule={() => { const task = tasks.find((item) => item.id === rescueTaskId); setRescueTaskId(""); if (task) openSchedule(task); }} />}
      {waitingTaskId && tasks.find((task) => task.id === waitingTaskId) && <WaitingModal task={tasks.find((task) => task.id === waitingTaskId)!} onSave={(waitingFor, followUpAt) => { updateTask(waitingTaskId, { status: "waiting", waitingFor, followUpAt, focusTimerStatus: "paused" }); setWaitingTaskId(""); setToast({ message: COPY.waiting }); }} onClose={() => setWaitingTaskId("")} />}
      {laterTaskId && tasks.find((task) => task.id === laterTaskId) && <LaterModal task={tasks.find((task) => task.id === laterTaskId)!} today={today} onSave={(plannedDate) => { const task = tasks.find((item) => item.id === laterTaskId)!; const changed = task.plannedDate !== plannedDate || task.startTime !== null; const now = new Date().toISOString(); updateTask(laterTaskId, { plannedDate, startTime: null, dayPart: null, isMustWin: false, status: "todo", rescheduleCount: task.rescheduleCount + (changed && Boolean(task.plannedDate || task.startTime) ? 1 : 0), rescheduleHistory: changed && Boolean(task.plannedDate || task.startTime) ? [...task.rescheduleHistory, { oldDate: task.plannedDate, oldTime: task.startTime, newDate: plannedDate, newTime: null, changedAt: now }] : task.rescheduleHistory, lastRescheduledAt: changed && Boolean(task.plannedDate || task.startTime) ? now : task.lastRescheduledAt }); setLaterTaskId(""); setToast({ message: "Đã để việc này sang một nhịp khác." }); }} onClose={() => setLaterTaskId("")} />}
      {endDayOpen && <EndDayModal tasks={tasks} date={today} mutateTasks={mutateTasks} onClose={() => setEndDayOpen(false)} />}
      {switchTask && <div className="modal-backdrop centered" role="presentation"><section className="switch-modal" role="dialog" aria-modal="true" aria-labelledby="switch-title"><span>CHUYỂN NHỊP TẬP TRUNG</span><h2 id="switch-title">Bạn muốn chuyển sang việc này bây giờ không?</h2><p>Một việc khác đang được làm. Việc cũ sẽ trở về “Cần làm” và thời gian đã tập trung vẫn được giữ.</p><strong>{switchTask.title}</strong><div><button onClick={() => setSwitchTask(null)}>Quay lại</button><button className="primary" onClick={() => activateFocus(switchTask)}>Chuyển sang việc này</button></div></section></div>}
    </div>
  );
}

function FocusMode({ task, tasks, mutateTasks, updateTask, onSchedule, onOpenEndDay, actualToday }: {
  task?: Task;
  tasks: Task[];
  mutateTasks: (mutator: (current: Task[]) => Task[]) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  onSchedule: (task: Task, mustWin?: boolean) => void;
  onOpenEndDay: () => void;
  actualToday: string;
}) {
  const [tick, setTick] = useState(0);
  const [outcome, setOutcome] = useState(task?.desiredOutcome || "");
  const [firstStep, setFirstStep] = useState(task?.firstStep || "");
  const [pauseOpen, setPauseOpen] = useState(false);
  const [rescueOpen, setRescueOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const [focusMessage, setFocusMessage] = useState("");

  useEffect(() => {
    if (!task || task.focusTimerStatus !== "running") return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTick(now);
      if (task.focusDurationSeconds - liveAccumulated(task, now) <= 0) {
        const endedAt = new Date(now).toISOString();
        const sessionSeconds = task.focusLastStartedAt ? Math.max(0, Math.floor((now - new Date(task.focusLastStartedAt).getTime()) / 1000)) : 0;
        updateTask(task.id, {
          focusTimerStatus: "expired",
          focusAccumulatedSeconds: task.focusAccumulatedSeconds + sessionSeconds,
          focusLastStartedAt: null,
          focusPausedAt: endedAt,
          focusSessions: sessionSeconds ? [...task.focusSessions, makeFocusSession(task, sessionSeconds, "paused", endedAt)] : task.focusSessions,
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [task, updateTask]);

  if (!task) return <section className="focus-missing"><span>FOCUS MODE</span><h1>Không tìm thấy việc này.</h1><p>Việc có thể đã được chuyển hoặc đường dẫn không còn đúng.</p><a href="/admin/ngay-cua-toi">Quay lại Ngày của tôi</a></section>;

  const accumulated = tick ? liveAccumulated(task, tick) : task.focusAccumulatedSeconds;
  const remaining = Math.max(0, task.focusDurationSeconds - accumulated);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const progress = Math.min(100, Math.max(0, (accumulated / Math.max(1, task.focusDurationSeconds)) * 100));

  const commitment = task.plannedDate
    ? `${task.plannedDate === actualToday ? "Hôm nay" : formatDate(task.plannedDate)} · ${task.startTime || "Chưa cam kết giờ"} · ${formatDuration(task.durationMinutes || 25)}`
    : `Chưa đặt lịch · ${formatDuration(task.durationMinutes || 25)}`;

  const startTimer = () => {
    const now = new Date().toISOString();
    const duration = task.focusTimerStatus === "expired" ? task.focusDurationSeconds + 25 * 60 : task.focusDurationSeconds || (task.durationMinutes || 25) * 60;
    updateTask(task.id, { focusTimerStatus: "running", focusStartedAt: task.focusStartedAt || now, focusLastStartedAt: now, focusPausedAt: null, focusDurationSeconds: duration, status: "doing" });
    setFocusMessage(task.focusTimerStatus === "expired" ? "Đã thêm 25 phút. Chỉ cần bước tiếp theo." : "Phiên tập trung đã bắt đầu.");
  };

  const pauseTimer = (reason: FocusSession["endReason"] = "paused") => {
    if (task.focusTimerStatus !== "running") {
      updateTask(task.id, { focusTimerStatus: "paused", focusPausedAt: new Date().toISOString(), focusLastStartedAt: null });
      return;
    }
    const now = new Date().toISOString();
    const sessionSeconds = task.focusLastStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(task.focusLastStartedAt).getTime()) / 1000)) : 0;
    updateTask(task.id, {
      focusTimerStatus: "paused",
      focusPausedAt: now,
      focusLastStartedAt: null,
      focusAccumulatedSeconds: task.focusAccumulatedSeconds + sessionSeconds,
      focusSessions: sessionSeconds ? [...task.focusSessions, makeFocusSession(task, sessionSeconds, reason, now)] : task.focusSessions,
    });
  };

  const completeFocus = () => {
    if (task.status === "done") return;
    const now = new Date().toISOString();
    const sessionSeconds = task.focusTimerStatus === "running" && task.focusLastStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(task.focusLastStartedAt).getTime()) / 1000)) : 0;
    const total = task.focusAccumulatedSeconds + sessionSeconds;
    updateTask(task.id, {
      status: "done",
      completedAt: task.completedAt || now,
      focusCompletedAt: now,
      focusTimerStatus: "completed",
      focusLastStartedAt: null,
      focusPausedAt: null,
      focusAccumulatedSeconds: total,
      focusSessions: sessionSeconds ? [...task.focusSessions, makeFocusSession(task, sessionSeconds, "completed", now)] : task.focusSessions,
    });
    setFocusMessage(task.isMustWin ? "Bạn đã thắng việc quan trọng nhất hôm nay." : total < task.focusDurationSeconds ? "Xong sớm cũng là một nhịp tốt." : "Bạn đã đi đến cuối việc này. Tốt rồi.");
    setCompletionOpen(true);
  };

  const openPause = () => {
    pauseTimer("paused");
    setPauseOpen(true);
  };

  const openRescue = () => {
    pauseTimer("stuck");
    setRescueOpen(true);
  };

  const backToDay = () => {
    if (task.focusTimerStatus === "running") setLeaveOpen(true);
    else window.location.href = "/admin/ngay-cua-toi";
  };

  if (breakOpen) return <section className="break-view"><span>NGHỈ MỘT NHỊP</span><div className="break-orb">5</div><h1>Nghỉ 5 phút.</h1><p>Đừng vội ôm việc mới. Uống nước, nhìn xa một chút rồi quay lại.</p><a href="/admin/ngay-cua-toi">Quay lại Ngày của tôi</a></section>;

  return <section className="focus-view">
    <header className="focus-header"><button onClick={backToDay}>← Quay lại Ngày của tôi</button><span>FOCUS MODE</span><small>{task.focusTimerStatus === "running" ? "Đang tập trung" : task.focusTimerStatus === "paused" ? "Đang tạm dừng" : "Một việc duy nhất"}</small></header>
    <div className="focus-center">
      <p className="focus-commitment">{commitment}</p>
      <h1>{task.title}</h1>
      <p className="focus-mantra">Bây giờ chỉ cần làm việc này.</p>

      <div className="focus-clarity">
        <section><span>XONG KHI</span>{task.desiredOutcome ? <p>{task.desiredOutcome}</p> : <form onSubmit={(event) => { event.preventDefault(); if (outcome.trim()) { updateTask(task.id, { desiredOutcome: outcome.trim() }); setFocusMessage("Đã lưu điều kiện hoàn thành."); } }}><input value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Ví dụ: Gửi xong proposal và biết bước tiếp theo." /><button>Lưu</button></form>}</section>
        <section className="first-step-block"><span>BƯỚC ĐẦU TIÊN</span>{task.firstStep ? <p>{task.firstStep}</p> : <><small>Bước nhỏ nhất bạn có thể làm ngay là gì?</small><form onSubmit={(event) => { event.preventDefault(); if (firstStep.trim()) { updateTask(task.id, { firstStep: firstStep.trim() }); setFocusMessage("Đã có bước đầu tiên. Chỉ cần bắt đầu từ đây."); } }}><input value={firstStep} onChange={(event) => setFirstStep(event.target.value)} placeholder="Ví dụ: Mở file proposal bản mới nhất." /><button>Lưu bước đầu tiên</button></form></>}</section>
      </div>

      <div className="timer-wrap">
        <div className="timer-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><div><strong>{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</strong><span>{task.focusTimerStatus === "running" ? "đang chạy" : task.focusTimerStatus === "paused" ? "đang tạm dừng" : task.focusTimerStatus === "expired" ? "đã hết thời lượng" : task.focusTimerStatus === "completed" ? "đã hoàn thành" : "thời gian đã cam kết"}</span></div></div>
        {task.focusTimerStatus === "expired" && <p>Hết thời lượng đã cam kết. Bạn muốn tiếp tục hay kết thúc việc này?</p>}
        {focusMessage && <p className="focus-message">{focusMessage}</p>}
        {task.status !== "done" && <button className="timer-button" onClick={task.focusTimerStatus === "running" ? openPause : startTimer}>{task.focusTimerStatus === "running" ? "Tạm dừng" : task.focusTimerStatus === "paused" ? "Tiếp tục" : task.focusTimerStatus === "expired" ? "Tiếp tục thêm 25 phút" : "Bắt đầu timer"}</button>}
      </div>

      {task.subtasks.length > 0 && <div className="focus-subtasks"><span>CÁC BƯỚC NHỎ</span>{task.subtasks.map((subtask) => <p key={subtask.id}>○ {subtask.title}</p>)}</div>}
    </div>
    <div className="focus-actions"><button className="focus-done" onClick={completeFocus} disabled={task.status === "done"}>✓ {task.status === "done" ? "Đã hoàn thành" : "Đã xong"}</button><button onClick={openPause}>Ⅱ Tạm dừng</button><button onClick={openRescue}>◇ Đang kẹt</button></div>

    {pauseOpen && <div className="modal-backdrop centered" role="presentation"><section className="pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span>TẠM DỪNG MỘT NHỊP</span><h2 id="pause-title">Bạn muốn giữ việc này ở trạng thái nào?</h2><p>Dừng lại một nhịp không có nghĩa là bỏ cuộc.</p><div><button onClick={() => { updateTask(task.id, { status: "doing" }); window.location.href = "/admin/ngay-cua-toi"; }}><strong>Vẫn đang làm</strong><small>Giữ việc mở, timer tạm dừng</small></button><button onClick={() => { updateTask(task.id, { status: "todo" }); window.location.href = "/admin/ngay-cua-toi"; }}><strong>Quay lại cần làm</strong><small>Bạn có thể bắt đầu lại sau</small></button><button onClick={() => { updateTask(task.id, { status: "todo" }); setPauseOpen(false); onSchedule(task); }}><strong>Đặt lại giờ sau</strong><small>Chọn một thời gian phù hợp hơn</small></button></div><button className="modal-cancel" onClick={() => setPauseOpen(false)}>Ở lại Focus Mode</button></section></div>}

    {rescueOpen && <RescueModal task={task} tasks={tasks} mutateTasks={mutateTasks} updateTask={updateTask} onClose={() => setRescueOpen(false)} onSchedule={() => { setRescueOpen(false); onSchedule(task); }} />}

    {leaveOpen && <div className="modal-backdrop centered" role="presentation"><section className="leave-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title"><h2 id="leave-title">Bạn muốn tạm dừng timer trước khi quay lại không?</h2><div><button onClick={() => setLeaveOpen(false)}>Ở lại Focus Mode</button><button onClick={() => { window.location.href = "/admin/ngay-cua-toi"; }}>Vẫn chạy và quay lại</button><button className="primary" onClick={() => { pauseTimer("paused"); window.location.href = "/admin/ngay-cua-toi"; }}>Tạm dừng và quay lại</button></div></section></div>}

    {completionOpen && <div className="modal-backdrop centered" role="presentation"><section className="completion-modal" role="dialog" aria-modal="true" aria-labelledby="complete-title"><span>ĐÃ KHÉP LẠI VIỆC NÀY</span><h2 id="complete-title">{task.isMustWin ? "Bạn đã thắng việc quan trọng nhất hôm nay." : "Xong việc này rồi. Nhẹ hơn một chút."}</h2><p>Tiếp theo bạn muốn làm gì?</p><div><button onClick={() => { window.location.href = "/admin/ngay-cua-toi"; }}>Làm việc tiếp theo</button><button onClick={() => { setCompletionOpen(false); setBreakOpen(true); }}>Nghỉ 5 phút</button><button className="primary" onClick={() => { setCompletionOpen(false); onOpenEndDay(); }}>Kết ngày</button></div></section></div>}
  </section>;
}

type RescueReason = "large" | "time" | "waiting" | "missing" | "start" | "unimportant";

function RescueModal({ task, mutateTasks, updateTask, onClose, onSchedule }: {
  task: Task;
  tasks: Task[];
  mutateTasks: (mutator: (current: Task[]) => Task[]) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  onClose: () => void;
  onSchedule: () => void;
}) {
  const [reason, setReason] = useState<RescueReason | null>(null);
  const [steps, setSteps] = useState(["", ""]);
  const [useFirst, setUseFirst] = useState(true);
  const [minimum, setMinimum] = useState(task.minimumVersion || "");
  const [reset25, setReset25] = useState(true);
  const [waitingFor, setWaitingFor] = useState(task.waitingFor || "");
  const [followPreset, setFollowPreset] = useState("tomorrow");
  const [customFollow, setCustomFollow] = useState("");
  const [missingItems, setMissingItems] = useState([""]);
  const [createCollector, setCreateCollector] = useState(false);
  const [originalStatus, setOriginalStatus] = useState<"stuck" | "todo" | "waiting">("stuck");
  const [tinyStep, setTinyStep] = useState(task.firstStep || "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const setListValue = (values: string[], index: number, value: string, setter: (next: string[]) => void) => setter(values.map((item, itemIndex) => itemIndex === index ? value : item));
  const followUp = () => {
    const now = new Date();
    if (followPreset === "hour") return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    if (followPreset === "end") { const end = new Date(); end.setHours(18, 0, 0, 0); if (end.getTime() < now.getTime()) end.setDate(end.getDate() + 1); return end.toISOString(); }
    if (followPreset === "monday") return `${nextMonday(localDate())}T09:00:00`;
    if (followPreset === "custom" && customFollow) return new Date(customFollow).toISOString();
    return `${addDays(localDate(), 1)}T09:00:00`;
  };

  const saveLarge = () => {
    const valid = steps.map((item) => item.trim()).filter(Boolean);
    if (!valid.length) { setError("Chỉ cần ghi ít nhất một bước nhỏ."); return; }
    const now = new Date().toISOString();
    updateTask(task.id, { subtasks: valid.map((title) => ({ id: makeId("subtask"), title, completed: false, createdAt: now })), firstStep: useFirst ? valid[0] : task.firstStep, status: "doing", stuckReason: "Việc quá lớn", stuckDetails: valid.join(" | "), focusTimerStatus: "paused", source: "rescue" });
    setMessage("Đã chia nhỏ. Bây giờ chỉ cần làm bước đầu tiên.");
  };

  const saveMinimum = () => {
    if (!minimum.trim()) { setError("Hãy mô tả phiên bản tối thiểu trong một câu ngắn."); return; }
    updateTask(task.id, { minimumVersion: minimum.trim(), notes: `${task.notes}${task.notes ? "\n" : ""}Phiên bản tối thiểu: ${minimum.trim()}`, durationMinutes: reset25 ? 25 : task.durationMinutes, focusDurationSeconds: reset25 ? Math.max(25 * 60, task.focusAccumulatedSeconds + 60) : task.focusDurationSeconds, status: "doing", stuckReason: "Không đủ thời gian", focusTimerStatus: "paused", source: "rescue" });
    setMessage("Đã chuyển thành phiên bản tối thiểu để bạn có thể bắt đầu.");
  };

  const saveWaiting = () => {
    if (!waitingFor.trim()) { setError("Ghi người hoặc thông tin bạn đang chờ."); return; }
    updateTask(task.id, { status: "waiting", waitingFor: waitingFor.trim(), followUpAt: followUp(), stuckReason: "Đang chờ người khác", focusTimerStatus: "paused", focusLastStartedAt: null, source: "rescue" });
    setMessage("Đã chuyển sang Đang chờ. App sẽ giữ việc này không bị trôi.");
  };

  const saveMissing = () => {
    const valid = missingItems.map((item) => item.trim()).filter(Boolean);
    if (!valid.length) { setError("Ghi ít nhất một thông tin cần tìm."); return; }
    const collector = normalizeTask({ id: makeId("task"), title: `Thu thập dữ liệu cho ${task.title}`, valueGroup: task.valueGroup, source: "rescue", notes: valid.join("\n") });
    mutateTasks((current) => {
      const updated = current.map((item) => item.id === task.id ? { ...item, missingInfoItems: valid, notes: `${item.notes}${item.notes ? "\n" : ""}Thông tin cần tìm: ${valid.join("; ")}`, stuckReason: "Thiếu dữ liệu", status: originalStatus, waitingFor: originalStatus === "waiting" ? "Thông tin cần bổ sung" : item.waitingFor, focusTimerStatus: "paused" as FocusTimerStatus, source: "rescue" as Task["source"], updatedAt: new Date().toISOString() } : item);
      return createCollector ? [collector, ...updated] : updated;
    });
    setMessage(createCollector ? "Đã tạo việc thu thập dữ liệu." : "Đã ghi lại thông tin cần tìm.");
  };

  const saveTinyStep = () => {
    if (!tinyStep.trim()) { setError("Chỉ cần một bước rất nhỏ."); return; }
    updateTask(task.id, { firstStep: tinyStep.trim(), stuckReason: "Không biết bắt đầu", status: "doing", focusTimerStatus: "paused", source: "rescue" });
    setMessage("Đã có bước đầu tiên. Chỉ cần bắt đầu từ đây.");
  };

  const abandon = () => {
    updateTask(task.id, { status: "dropped", isMustWin: false, archivedAt: new Date().toISOString(), stuckReason: "Không còn quan trọng", focusTimerStatus: "paused", focusLastStartedAt: null, source: "rescue" });
    setMessage("Buông một việc cũng là một quyết định tốt.");
  };

  if (message) return <div className="modal-backdrop rescue-backdrop" role="presentation"><section className="rescue-modal rescue-success" role="dialog" aria-modal="true" aria-labelledby="rescue-success"><span>ĐÃ TÌM ĐƯỢC LỐI RA</span><h2 id="rescue-success">{message}</h2><p>Việc này vẫn còn ở đây. Bạn có thể quay lại khi sẵn sàng.</p><div><button onClick={() => { if (task.status === "dropped" || reason === "waiting") window.location.href = "/admin/ngay-cua-toi"; else onClose(); }}>Quay lại Focus Mode</button><a href="/admin/ngay-cua-toi">Quay lại Ngày của tôi</a><a href="/admin/backlog">Mở Backlog</a></div></section></div>;

  const reasonCards: Array<{ key: RescueReason; title: string; copy: string }> = [
    { key: "large", title: "Việc quá lớn", copy: "Ta chia thành những bước nhỏ hơn." },
    { key: "time", title: "Không đủ thời gian", copy: "Làm phiên bản tối thiểu có ích." },
    { key: "waiting", title: "Đang chờ người khác", copy: "Ghi rõ điều đang chờ và lúc xem lại." },
    { key: "missing", title: "Thiếu dữ liệu", copy: "Ghi lại đúng thông tin cần tìm." },
    { key: "start", title: "Không biết bắt đầu", copy: "Tìm một bước dưới 5 phút." },
    { key: "unimportant", title: "Không còn quan trọng", copy: "Được phép bỏ một việc không còn giá trị." },
  ];

  return <div className="modal-backdrop rescue-backdrop" role="presentation"><section className="rescue-modal" role="dialog" aria-modal="true" aria-labelledby="rescue-title">
    <header><div><span>CỨU HỘ KHI KẸT</span><h2 id="rescue-title">{reason ? reasonCards.find((item) => item.key === reason)?.title : "Bạn đang kẹt ở đâu?"}</h2><p>{reason ? "Ta chọn một hành động nhỏ để đi tiếp." : "Kẹt là bình thường. Ta tìm lối ra nhỏ hơn."}</p></div><button className="close" onClick={onClose} aria-label="Đóng">×</button></header>
    {!reason ? <div className="rescue-grid">{reasonCards.map((item) => <button key={item.key} onClick={() => { setReason(item.key); setError(""); }}><span>○</span><strong>{item.title}</strong><small>{item.copy}</small></button>)}</div> : <div className="rescue-form">
      {reason === "large" && <><label>Ta chia việc này thành những bước nhỏ nào?</label>{steps.map((step, index) => <input key={index} value={step} onChange={(event) => setListValue(steps, index, event.target.value, setSteps)} placeholder={`Bước nhỏ ${index + 1}`} />)}{steps.length < 5 && <button className="add-line" onClick={() => setSteps([...steps, ""])}>+ Thêm bước</button>}<label className="inline-check"><input type="checkbox" checked={useFirst} onChange={(event) => setUseFirst(event.target.checked)} /> Dùng bước đầu tiên làm bước bắt đầu ngay</label><button className="primary form-submit" onClick={saveLarge}>Lưu các bước nhỏ</button></>}
      {reason === "time" && <><label>Nếu chỉ có 25 phút, phiên bản tối thiểu của việc này là gì?</label><textarea value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="Phiên bản tối thiểu là…" /><label className="inline-check"><input type="checkbox" checked={reset25} onChange={(event) => setReset25(event.target.checked)} /> Đặt thời lượng còn lại thành 25 phút</label><button className="primary form-submit" onClick={saveMinimum}>Làm bản tối thiểu</button><button className="secondary-link" onClick={onSchedule}>Đặt lại giờ sau</button></>}
      {reason === "waiting" && <><label>Bạn đang chờ ai hoặc điều gì?</label><input value={waitingFor} onChange={(event) => setWaitingFor(event.target.value)} placeholder="Ví dụ: Chờ anh Nam phản hồi proposal" /><label>Khi nào cần nhắc lại?</label><div className="choice-row">{[["hour","1 giờ nữa"],["end","Cuối ngày"],["tomorrow","Ngày mai"],["monday","Thứ Hai tới"],["custom","Thời gian khác"]].map(([key,label]) => <button key={key} className={followPreset === key ? "chosen" : ""} onClick={() => setFollowPreset(key)}>{label}</button>)}</div>{followPreset === "custom" && <input type="datetime-local" value={customFollow} onChange={(event) => setCustomFollow(event.target.value)} />}<button className="primary form-submit" onClick={saveWaiting}>Chuyển sang Đang chờ</button></>}
      {reason === "missing" && <><label>Bạn cần thêm thông tin gì để làm tiếp?</label>{missingItems.map((item, index) => <input key={index} value={item} onChange={(event) => setListValue(missingItems, index, event.target.value, setMissingItems)} placeholder="Ví dụ: Cần số liệu báo giá gần nhất" />)}{missingItems.length < 5 && <button className="add-line" onClick={() => setMissingItems([...missingItems, ""])}>+ Thêm thông tin</button>}<label className="inline-check"><input type="checkbox" checked={createCollector} onChange={(event) => setCreateCollector(event.target.checked)} /> Tạo việc “Thu thập dữ liệu cho {task.title}”</label><label>Việc gốc nên ở trạng thái nào?</label><select value={originalStatus} onChange={(event) => setOriginalStatus(event.target.value as typeof originalStatus)}><option value="stuck">Bị kẹt</option><option value="todo">Cần làm</option><option value="waiting">Đang chờ</option></select><button className="primary form-submit" onClick={saveMissing}>Lưu thông tin cần tìm</button></>}
      {reason === "start" && <><label>Bước nhỏ nhất dưới 5 phút là gì?</label><input value={tinyStep} onChange={(event) => setTinyStep(event.target.value)} placeholder="Ví dụ: Mở tài liệu đang làm dở." /><button className="primary form-submit" onClick={saveTinyStep}>Lưu bước đầu tiên</button></>}
      {reason === "unimportant" && <div className="abandon-confirm"><p>Nếu việc này không còn quan trọng, bạn có thể bỏ nó khỏi hôm nay.</p><h3>Bạn có chắc muốn bỏ việc này không?</h3><button className="abandon-button" onClick={abandon}>Bỏ việc này</button><button onClick={() => setReason(null)}>Giữ lại</button></div>}
      {error && <p className="form-error">{error}</p>}
      <button className="modal-cancel" onClick={() => { setReason(null); setError(""); }}>← Quay lại 6 lựa chọn</button>
    </div>}
  </section></div>;
}

function WeekView({ tasks, actualToday }: { tasks: Task[]; actualToday: string }) {
  const current = new Date(`${actualToday}T12:00:00`);
  const offset = current.getDay() === 0 ? -6 : 1 - current.getDay();
  const monday = addDays(actualToday, offset);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  return <section className="content-view">
    <header className="view-header"><div><span>TUẦN CỦA TÔI</span><h1>Một tuần vừa đủ rõ</h1><p>Nhìn nhịp chung, rồi quay về một ngày cụ thể.</p></div><a className="header-action" href="/admin/ngay-cua-toi">Về hôm nay</a></header>
    <div className="week-note"><span>○</span><p>Không cần lấp kín cả tuần. Chỉ cam kết những việc bạn thật sự có chỗ để làm.</p></div>
    <div className="week-grid">
      {days.map((date) => {
        const dayTasks = tasks.filter((task) => task.plannedDate === date && task.status !== "dropped");
        const scheduled = dayTasks.filter((task) => task.startTime);
        const mustWin = dayTasks.find((task) => task.isMustWin);
        const done = dayTasks.filter((task) => task.status === "done").length;
        const isToday = date === actualToday;
        return <a key={date} className={`week-card ${isToday ? "today" : ""}`} href={`/admin/ngay-cua-toi?date=${date}`}>
          <div className="week-date"><span>{new Intl.DateTimeFormat("vi-VN", { weekday: "short" }).format(new Date(`${date}T12:00:00`))}</span><strong>{new Date(`${date}T12:00:00`).getDate()}</strong>{isToday && <em>Hôm nay</em>}</div>
          <div className="week-summary"><p>{scheduled.length ? `${scheduled.length} việc đã có giờ` : "Chưa có việc cam kết"}</p>{done > 0 && <small>{done} việc đã xong</small>}</div>
          <div className={`week-win ${mustWin ? "has-win" : ""}`}><span>{mustWin ? "VIỆC PHẢI THẮNG" : "ĐANG ĐỂ MỞ"}</span><strong>{mustWin ? mustWin.title : "Chọn khi bạn sẵn sàng"}</strong></div>
          <span className="open-day">Mở ngày này →</span>
        </a>;
      })}
    </div>
  </section>;
}

type BacklogFilter = "all" | "unscheduled" | "scheduled" | "stuck" | "waiting" | "done" | "dropped";
type CalendarTab = "today" | "week" | "month" | "backlog";

function attentionReasons(task: Task, today: string) {
  if (task.status === "done" || task.status === "dropped" || (task.attentionSnoozedUntil && task.attentionSnoozedUntil >= today)) return [];
  const reasons: string[] = [];
  if (task.plannedDate && task.plannedDate < today) reasons.push("Đã qua ngày dự định.");
  if (task.status === "stuck") reasons.push("Việc này đang bị kẹt.");
  if (task.status === "waiting" && task.followUpAt && new Date(task.followUpAt).getTime() <= Date.now()) reasons.push("Đã đến lúc nhắc lại.");
  if (task.rescheduleCount >= 3) reasons.push("Bạn đã dời việc này nhiều lần.");
  return reasons;
}

function startOfWeek(date: string) {
  const value = new Date(`${date}T12:00:00`);
  const distance = (value.getDay() + 6) % 7;
  return addDays(date, -distance);
}

function BacklogView({ tasks, actualToday, onSchedule, onStart, onComplete, onStuck, onWaiting, onLater, onDrop, onEdit, onMustWin, onRestore, onUpdate, onAddForDate }: {
  tasks: Task[];
  actualToday: string;
  onSchedule: (task: Task, mustWin?: boolean) => void;
  onStart: (task: Task) => void;
  onComplete: (task: Task) => void;
  onStuck: (task: Task) => void;
  onWaiting: (task: Task) => void;
  onLater: (task: Task) => void;
  onDrop: (task: Task) => void;
  onEdit: (task: Task) => void;
  onMustWin: (task: Task) => void;
  onRestore: (task: Task) => void;
  onUpdate: (id: string, updates: Partial<Task>) => void;
  onAddForDate: (title: string, date: string) => void;
}) {
  const [tab, setTabState] = useState<CalendarTab>("backlog");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BacklogFilter>("all");
  const [detailId, setDetailId] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [monthAnchor, setMonthAnchor] = useState(`${actualToday.slice(0, 8)}01`);
  const [showAllAttention, setShowAllAttention] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- URL tab hydration happens once on the client */
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    if (["today", "week", "month", "backlog"].includes(value || "")) setTabState(value as CalendarTab);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const setTab = (next: CalendarTab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url);
  };
  const filters: Array<{ key: BacklogFilter; label: string }> = [
    { key: "all", label: "Tất cả" }, { key: "unscheduled", label: "Chưa cam kết" }, { key: "scheduled", label: "Đã lên lịch" },
    { key: "stuck", label: "Bị kẹt" }, { key: "waiting", label: "Đang chờ" },
    { key: "done", label: "Hoàn thành" }, { key: "dropped", label: "Đã bỏ" },
  ];
  const visible = tasks.filter((task) => {
    const matchesQuery = `${task.title} ${task.notes} ${task.waitingFor} ${task.bcmLink || ""}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"));
    if (!matchesQuery) return false;
    if (filter === "all") return task.status !== "dropped";
    if (filter === "unscheduled") return (!task.plannedDate || !task.startTime) && task.status !== "dropped";
    if (filter === "scheduled") return Boolean(task.plannedDate && task.startTime) && task.status !== "dropped";
    return task.status === filter;
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const emptyCopy: Record<BacklogFilter, string> = {
    all: "Không có việc nào đang chờ. Đầu óc nhẹ hơn một chút rồi.",
    unscheduled: "Không còn việc nào bị để lửng.",
    scheduled: "Chưa có việc nào được cam kết vào thời gian thật.",
    stuck: "Không có việc nào đang bị kẹt.",
    waiting: "Không có việc nào đang chờ thêm thông tin.",
    done: "Chưa có việc hoàn thành trong nhóm này.",
    dropped: "Chưa có việc nào được để sang một bên.",
  };

  const todayTasks = tasks.filter((task) => task.plannedDate === actualToday && task.status !== "dropped");
  const attention = tasks.filter((task) => attentionReasons(task, actualToday).length > 0);
  const weekStart = startOfWeek(actualToday);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const monthDate = new Date(`${monthAnchor}T12:00:00`);
  const monthLabel = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(monthDate);
  const gridStart = addDays(monthAnchor, -monthDate.getDay());
  const monthDates = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const detailTask = tasks.find((task) => task.id === detailId);

  const taskCard = (task: Task, compact = false) => <article key={task.id} className={`calendar-task status-${task.status} ${compact ? "compact" : ""}`}>
    <button className="task-open" onClick={() => setDetailId(task.id)}><span className={`status-dot ${task.status}`} /><span><strong>{task.title}</strong><small>{task.startTime || "Chưa cam kết giờ"} · {STATUS_LABEL[task.status]}{task.isMustWin ? " · Việc phải thắng" : ""}</small></span></button>
    {!compact && <div className="calendar-task-actions">{!["done", "dropped"].includes(task.status) && <><button className="primary" onClick={() => onStart(task)}>{task.status === "doing" ? "Mở Focus" : "Bắt đầu"}</button><button onClick={() => onSchedule(task)}>{task.startTime ? "Đổi giờ" : "Đặt giờ"}</button></>}{task.status === "waiting" && <button onClick={() => onWaiting(task)}>Cập nhật chờ</button>}{task.status === "stuck" && <button onClick={() => onStuck(task)}>Cứu hộ</button>}</div>}
  </article>;

  return <section className="content-view backlog-view calendar-hub">
    <header className="view-header"><div><span>PERSONAL WORK OS</span><h1>Lịch &amp; Backlog</h1><p>Xem lại việc đã cam kết, việc còn lửng và những việc cần quyết định.</p></div><a className="header-action" href="/admin/ngay-cua-toi">← Ngày của tôi</a></header>
    <nav className="calendar-tabs" aria-label="Lịch và Backlog">{[["today","Hôm nay"],["week","Tuần này"],["month","Tháng"],["backlog","Backlog"]].map(([key,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key as CalendarTab)}>{label}</button>)}</nav>

    {tab === "today" && <div className="calendar-tab-panel"><div className="light-summary"><div><strong>{todayTasks.find((task) => task.isMustWin)?.title || "Chưa chọn"}</strong><span>Việc phải thắng</span></div><div><strong>{todayTasks.filter((task) => task.startTime).length}</strong><span>Đã cam kết giờ</span></div><div><strong>{todayTasks.filter((task) => !task.startTime).length}</strong><span>Chưa cam kết giờ</span></div><div><strong>{todayTasks.filter((task) => attentionReasons(task, actualToday).length).length}</strong><span>Cần chú ý</span></div></div>{todayTasks.length ? <>{(["morning","afternoon","evening"] as DayPart[]).map((part) => { const partTasks = todayTasks.filter((task) => task.dayPart === part && task.startTime).sort((a,b) => (a.startTime || "").localeCompare(b.startTime || "")); return <section className={`calendar-group ${currentPart() === part ? "current" : ""}`} key={part}><header><h2>{part === "morning" ? "Sáng" : part === "afternoon" ? "Chiều" : "Tối"}</h2><span>{partTasks.length} việc</span></header>{partTasks.length ? partTasks.map((task) => taskCard(task)) : <p className="soft-empty">Buổi này đang trống.</p>}</section>; })}<section className="calendar-group"><header><h2>Chưa cam kết giờ</h2><span>{todayTasks.filter((task) => !task.startTime).length} việc</span></header><p className="group-help">Có ngày nhưng chưa có giờ, nghĩa là việc này chưa thật sự được cam kết.</p>{todayTasks.filter((task) => !task.startTime).map((task) => taskCard(task))}</section>{todayTasks.some((task) => task.status === "done") && <section className="calendar-group completed-group"><header><h2>Hoàn thành</h2><span>{todayTasks.filter((task) => task.status === "done").length} việc đã xong</span></header></section>}</> : <div className="hub-empty"><h2>{COPY.emptyDay}</h2><p>Đặt một việc vào hôm nay hoặc mở Backlog để chọn.</p><button onClick={() => setSelectedDay(actualToday)}>Thêm việc</button><button onClick={() => setTab("backlog")}>Mở Backlog</button></div>}</div>}

    {tab === "week" && <div className="calendar-tab-panel"><div className="week-hub-grid">{weekDates.map((date) => { const dateTasks = tasks.filter((task) => task.plannedDate === date && task.status !== "dropped"); const timed = dateTasks.filter((task) => task.startTime).sort((a,b) => (a.startTime || "").localeCompare(b.startTime || "")); const minutes = timed.reduce((sum,task) => sum + task.durationMinutes, 0); return <article key={date} className={`week-hub-day ${date === actualToday ? "today" : ""}`}><button className="week-day-head" onClick={() => setSelectedDay(date)}><span>{new Intl.DateTimeFormat("vi-VN", { weekday: "short" }).format(new Date(`${date}T12:00:00`))}</span><strong>{new Date(`${date}T12:00:00`).getDate()}</strong><small>{dateTasks.length} việc</small></button>{dateTasks.find((task) => task.isMustWin) && <p className="week-must-win">★ {dateTasks.find((task) => task.isMustWin)!.title}</p>}{timed.slice(0,3).map((task) => taskCard(task, true))}{timed.length > 3 && <button className="more-tasks" onClick={() => setSelectedDay(date)}>+{timed.length - 3} việc khác</button>}{!dateTasks.length && <p className="soft-empty">Ngày này còn trống.</p>}{(timed.length > 5 || minutes > 360) && <p className="full-day-note">Ngày này hơi đầy.</p>}<button className="add-day-task" onClick={() => setSelectedDay(date)}>+ Thêm việc</button></article>; })}</div></div>}

    {tab === "month" && <div className="calendar-tab-panel"><div className="month-toolbar"><button onClick={() => { const d = new Date(`${monthAnchor}T12:00:00`); d.setMonth(d.getMonth()-1); setMonthAnchor(localDate(d).slice(0,8)+"01"); }}>←</button><h2>{monthLabel.charAt(0).toUpperCase()+monthLabel.slice(1)}</h2><button onClick={() => { const d = new Date(`${monthAnchor}T12:00:00`); d.setMonth(d.getMonth()+1); setMonthAnchor(localDate(d).slice(0,8)+"01"); }}>→</button></div><div className="month-weekdays">{["CN","T2","T3","T4","T5","T6","T7"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{monthDates.map((date) => { const dayTasks = tasks.filter((task) => task.plannedDate === date && task.status !== "dropped"); const minutes = dayTasks.reduce((sum, task) => sum + (task.startTime ? task.durationMinutes : 0), 0); const risk = dayTasks.length >= 6 || minutes > 360 || dayTasks.filter((task) => ["stuck","waiting"].includes(task.status)).length >= 2; return <button key={date} className={`${date.slice(0,7) !== monthAnchor.slice(0,7) ? "outside" : ""} ${date === actualToday ? "today" : ""}`} onClick={() => setSelectedDay(date)}><strong>{Number(date.slice(-2))}</strong>{dayTasks.length > 0 && <><span className="month-dot" /><small>{dayTasks.length} việc</small></>}{risk && <em>Hơi đầy</em>}</button>; })}</div>{!tasks.some((task) => task.plannedDate?.slice(0,7) === monthAnchor.slice(0,7) && task.status !== "dropped") && <div className="month-empty"><p>{COPY.emptyMonth}</p><button onClick={() => setSelectedDay(monthAnchor)}>Thêm việc đầu tiên</button></div>}</div>}

    {tab === "backlog" && <div className="calendar-tab-panel"><div className="backlog-tools"><label><span>Tìm công việc</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên, ghi chú hoặc người đang chờ…" /></label><div className="result-count"><strong>{visible.length}</strong><span>việc đang hiển thị</span></div></div>{attention.length > 0 && <section className="attention-section"><header><div><span>NHẮC NHẸ</span><h2>{COPY.attentionTitle}</h2><p>{COPY.attentionIntro}</p></div><strong>{attention.length}</strong></header><div>{attention.slice(0, showAllAttention ? attention.length : 5).map((task) => <article className="attention-card" key={task.id}><button onClick={() => setDetailId(task.id)}><strong>{task.title}</strong>{attentionReasons(task, actualToday).map((reason) => <small key={reason}>{reason}</small>)}</button><div><button className="primary" onClick={() => onSchedule(task)}>Đặt lại lịch</button><button onClick={() => onStart(task)}>Bắt đầu</button><button onClick={() => onStuck(task)}>Cứu hộ</button><button onClick={() => onWaiting(task)}>Đang chờ</button><button onClick={() => onDrop(task)}>Bỏ</button></div></article>)}</div>{attention.length > 5 && <button className="attention-more" onClick={() => setShowAllAttention(!showAllAttention)}>{showAllAttention ? "Thu gọn" : `Xem thêm ${attention.length - 5} việc`}</button>}</section>}
    <div className="filter-row" aria-label="Lọc trạng thái">{filters.map((item) => <button key={item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}>{item.label}<small>{tasks.filter((task) => item.key === "all" ? task.status !== "dropped" : item.key === "unscheduled" ? (!task.plannedDate || !task.startTime) && task.status !== "dropped" : item.key === "scheduled" ? Boolean(task.plannedDate && task.startTime) && task.status !== "dropped" : task.status === item.key).length}</small></button>)}</div>
    <div className="backlog-list">
      {visible.length ? visible.map((task) => <article key={task.id} className={`backlog-card status-${task.status}`}>
        <div className="backlog-status"><span className={`status-dot ${task.status}`} /><span>{task.plannedDate ? task.startTime ? `${formatDate(task.plannedDate)} · ${task.startTime}` : `${formatDate(task.plannedDate)} · Chưa cam kết giờ` : "Chưa đặt lịch"}</span></div>
        <button className="backlog-copy" onClick={() => setDetailId(task.id)}><span><strong>{task.title}</strong>{task.isMustWin && <em className="tiny-win">Việc phải thắng</em>}</span><span className="backlog-meta"><span className="value-chip" data-group={task.valueGroup}>{task.valueGroup}</span><span>{STATUS_LABEL[task.status]}</span><span>{formatDuration(task.durationMinutes)}</span></span>{task.stuckReason && <small>Đang kẹt: {task.stuckReason}</small>}</button>
        <div className="backlog-actions">
          {task.status === "dropped" ? <button className="soft-primary" onClick={() => onRestore(task)}>Khôi phục</button> : <>
            {!task.startTime && <button className="soft-primary" onClick={() => onSchedule(task)}>Đặt lịch</button>}
            {task.startTime && task.status === "todo" && <button className="soft-primary" onClick={() => onStart(task)}>Bắt đầu</button>}
            {task.status === "doing" && <button className="soft-primary" onClick={() => onStart(task)}>Tiếp tục</button>}
            {task.status === "waiting" && <button onClick={() => onWaiting(task)}>Cập nhật chờ</button>}
            {task.status !== "done" && task.startTime && <button onClick={() => onSchedule(task)}>Đổi giờ</button>}
            {task.status !== "done" && <button onClick={() => onStuck(task)}>Bị kẹt</button>}
            {!task.isMustWin && task.status !== "done" && <button onClick={() => onMustWin(task)}>Chọn phải thắng</button>}
            <details><summary aria-label={`Thêm hành động cho ${task.title}`}>•••</summary><div><button onClick={() => onEdit(task)}>Chỉnh sửa</button>{task.status !== "done" && <><button onClick={() => onComplete(task)}>Hoàn thành</button><button onClick={() => onLater(task)}>Để sau</button></>}<button className="danger" onClick={() => onDrop(task)}>Bỏ việc</button></div></details>
          </>}
        </div>
      </article>) : <div className="backlog-empty"><span>○</span><h2>{query ? "Không tìm thấy việc nào khớp." : emptyCopy[filter]}</h2><p>{query ? "Thử một từ khóa ngắn hơn hoặc xóa tìm kiếm." : "Để sau cũng được, miễn là bạn biết nó đang ở đâu."}</p>{query && <button onClick={() => setQuery("")}>Xóa tìm kiếm</button>}</div>}
    </div></div>}
    {selectedDay && <DaySheet date={selectedDay} tasks={tasks.filter((task) => task.plannedDate === selectedDay && task.status !== "dropped")} onClose={() => setSelectedDay("")} onAdd={(title) => onAddForDate(title, selectedDay)} onOpen={(task) => { setSelectedDay(""); setDetailId(task.id); }} onStart={onStart} onSchedule={onSchedule} />}
    {detailTask && <TaskDetailSheet task={detailTask} onClose={() => setDetailId("")} onStart={onStart} onSchedule={onSchedule} onComplete={onComplete} onStuck={onStuck} onWaiting={onWaiting} onLater={onLater} onDrop={onDrop} onUpdate={onUpdate} />}
  </section>;
}

function WaitingModal({ task, onSave, onClose }: { task: Task; onSave: (waitingFor: string, followUpAt: string | null) => void; onClose: () => void }) {
  const [waitingFor, setWaitingFor] = useState(task.waitingFor);
  const [followUpAt, setFollowUpAt] = useState(task.followUpAt?.slice(0, 10) || addDays(localDate(), 1));
  return <div className="modal-backdrop centered" role="presentation"><section className="waiting-modal" role="dialog" aria-modal="true" aria-labelledby="waiting-title"><header><div><span>ĐANG CHỜ</span><h2 id="waiting-title">App sẽ giữ việc này không bị trôi.</h2><p>{task.title}</p></div><button className="close" onClick={onClose}>×</button></header><label>Bạn đang chờ ai hoặc điều gì?<input autoFocus value={waitingFor} onChange={(event) => setWaitingFor(event.target.value)} placeholder="Ví dụ: phản hồi từ anh Nam" /></label><label>Nhắc lại vào ngày<input type="date" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} /></label><footer><button onClick={onClose}>Hủy</button><button className="primary" onClick={() => onSave(waitingFor.trim(), followUpAt ? `${followUpAt}T09:00:00` : null)}>Lưu trạng thái chờ</button></footer></section></div>;
}

function LaterModal({ task, today, onSave, onClose }: { task: Task; today: string; onSave: (date: string | null) => void; onClose: () => void }) {
  const day = new Date(`${today}T12:00:00`);
  const saturdayDistance = ((6 - day.getDay() + 7) % 7) || 7;
  const [choice, setChoice] = useState<"tomorrow" | "weekend" | "custom" | "none">("tomorrow");
  const [customDate, setCustomDate] = useState(addDays(today, 2));
  const date = choice === "tomorrow" ? addDays(today, 1) : choice === "weekend" ? addDays(today, saturdayDistance) : choice === "custom" ? customDate : null;
  return <div className="modal-backdrop centered" role="presentation"><section className="waiting-modal later-modal" role="dialog" aria-modal="true" aria-labelledby="later-title"><header><div><span>ĐỂ SAU</span><h2 id="later-title">Việc này sẽ đi đâu tiếp?</h2><p>{task.title}</p></div><button className="close" onClick={onClose}>×</button></header><div className="later-choices">{[["tomorrow","Ngày mai"],["weekend","Cuối tuần"],["custom","Ngày khác"],["none","Không đặt ngày"]].map(([key,label]) => <button key={key} className={choice === key ? "chosen" : ""} onClick={() => setChoice(key as typeof choice)}>{label}</button>)}</div>{choice === "custom" && <label>Chọn ngày<input type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} /></label>}<footer><button onClick={onClose}>Hủy</button><button className="primary" onClick={() => onSave(date)}>Để việc này sang sau</button></footer></section></div>;
}

function DaySheet({ date, tasks, onClose, onAdd, onOpen, onStart, onSchedule }: { date: string; tasks: Task[]; onClose: () => void; onAdd: (title: string) => void; onOpen: (task: Task) => void; onStart: (task: Task) => void; onSchedule: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  return <div className="modal-backdrop" role="presentation"><section className="day-sheet" role="dialog" aria-modal="true" aria-labelledby="day-sheet-title"><header><div><span>CHI TIẾT NGÀY</span><h2 id="day-sheet-title">{formatDate(date)}</h2><p>{tasks.length ? `${tasks.length} việc đã có chỗ trong ngày.` : "Ngày này còn trống."}</p></div><button className="close" onClick={onClose}>×</button></header><form onSubmit={(event) => { event.preventDefault(); if (!title.trim()) return; onAdd(title); setTitle(""); }}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Thêm việc vào ngày này…" /><button className="primary">Thêm việc</button></form><div className="day-sheet-list">{tasks.length ? tasks.sort((a,b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99")).map((task) => <article key={task.id}><button onClick={() => onOpen(task)}><span className={`status-dot ${task.status}`} /><span><strong>{task.title}</strong><small>{task.startTime || "Chưa cam kết giờ"} · {STATUS_LABEL[task.status]}</small></span></button><div>{!["done","dropped"].includes(task.status) && <><button onClick={() => onStart(task)}>Bắt đầu</button><button onClick={() => onSchedule(task)}>{task.startTime ? "Đổi giờ" : "Đặt giờ"}</button></>}</div></article>) : <div className="hub-empty small"><h3>Ngày này còn trống.</h3><p>Không cần lấp đầy mọi khoảng trống.</p></div>}</div></section></div>;
}

function TaskDetailSheet({ task, onClose, onStart, onSchedule, onComplete, onStuck, onWaiting, onLater, onDrop, onUpdate }: { task: Task; onClose: () => void; onStart: (task: Task) => void; onSchedule: (task: Task) => void; onComplete: (task: Task) => void; onStuck: (task: Task) => void; onWaiting: (task: Task) => void; onLater: (task: Task) => void; onDrop: (task: Task) => void; onUpdate: (id: string, updates: Partial<Task>) => void }) {
  const [draft, setDraft] = useState({ title: task.title, desiredOutcome: task.desiredOutcome, firstStep: task.firstStep, notes: task.notes });
  const save = () => onUpdate(task.id, draft);
  return <div className="modal-backdrop" role="presentation"><section className="task-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header><div><span>CHI TIẾT VIỆC NHANH</span><h2 id="detail-title">{task.title}</h2><p><span className={`status-dot ${task.status}`} /> {STATUS_LABEL[task.status]}{task.isMustWin ? " · Việc phải thắng" : ""}</p></div><button className="close" onClick={onClose}>×</button></header><div className="task-detail-body"><section className="commitment-grid"><div><span>Ngày</span><strong>{task.plannedDate ? formatDate(task.plannedDate) : "Chưa đặt lịch"}</strong></div><div><span>Giờ</span><strong>{task.startTime || "Chưa cam kết giờ"}</strong></div><div><span>Thời lượng</span><strong>{formatDuration(task.durationMinutes)}</strong></div><div><span>Cam kết</span><strong>{task.plannedDate && task.startTime ? "Đã cam kết giờ" : task.plannedDate ? "Chưa cam kết giờ" : "Chưa đặt lịch"}</strong></div></section>{task.status === "waiting" && <div className="context-note waiting"><strong>{COPY.waiting}</strong><span>{task.waitingFor || "Chưa ghi điều đang chờ."}{task.followUpAt ? ` · Nhắc lại ${formatDate(task.followUpAt.slice(0,10))}` : ""}</span></div>}{task.status === "stuck" && <div className="context-note stuck"><strong>Kẹt là bình thường. Ta tìm lối ra.</strong><span>{task.stuckReason || "Chỉ cần tìm bước nhỏ tiếp theo."}</span></div>}<section className="detail-fields"><label>Tên việc<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Xong khi<input value={draft.desiredOutcome} onChange={(event) => setDraft({ ...draft, desiredOutcome: event.target.value })} placeholder="Thêm tiêu chí hoàn thành" /></label><label>Bước đầu tiên<input value={draft.firstStep} onChange={(event) => setDraft({ ...draft, firstStep: event.target.value })} placeholder="Thêm bước nhỏ đầu tiên" /></label><label>Ghi chú<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Thêm ghi chú nếu cần" /></label><button className="save-detail" onClick={save}>Lưu thay đổi</button></section>{task.bcmLink && <details className="bcm-context"><summary>Có ngữ cảnh Lõi kinh doanh hỗ trợ</summary><p>{task.bcmLink}</p><small>Dữ liệu này lấy từ BCM đã có. Work OS không tự sửa Lõi kinh doanh.</small></details>}</div><footer className="detail-actions">{!["done","dropped"].includes(task.status) && <><button className="primary" onClick={() => { onClose(); onStart(task); }}>Bắt đầu</button><button onClick={() => onSchedule(task)}>{task.startTime ? "Đổi giờ" : "Đặt lịch"}</button><button onClick={() => onComplete(task)}>Hoàn thành</button><button onClick={() => onStuck(task)}>Cứu hộ</button><button onClick={() => onWaiting(task)}>Đang chờ</button><button onClick={() => onLater(task)}>Để sau</button><button className="danger" onClick={() => onDrop(task)}>Bỏ</button></>}{task.status === "done" && <span>✓ Xong việc này rồi.</span>}</footer></section></div>;
}

function EndDayModal({ tasks, date, mutateTasks, onClose }: { tasks: Task[]; date: string; mutateTasks: (mutator: (current: Task[]) => Task[]) => void; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [decisions, setDecisions] = useState<Record<string, "tomorrow" | "weekend" | "waiting" | "drop">>({});
  const [keepTime, setKeepTime] = useState<Record<string, boolean>>({});
  const [waitingDetails, setWaitingDetails] = useState<Record<string, string>>({});
  const [tomorrowMustWin, setTomorrowMustWin] = useState("");
  const [newTomorrowTitle, setNewTomorrowTitle] = useState("");
  const [timePreset, setTimePreset] = useState<"09:00" | "14:00" | "custom" | "none">("09:00");
  const [customTime, setCustomTime] = useState("16:00");
  const dayTasks = tasks.filter((task) => task.plannedDate === date && task.status !== "dropped");
  const mustWin = dayTasks.find((task) => task.isMustWin);
  const done = dayTasks.filter((task) => task.status === "done");
  const unresolved = dayTasks.filter((task) => !["done", "dropped"].includes(task.status));
  const stuck = dayTasks.filter((task) => task.status === "stuck");
  const waiting = dayTasks.filter((task) => task.status === "waiting");
  const totalFocus = dayTasks.reduce((sum, task) => sum + liveAccumulated(task), 0);
  const tomorrow = addDays(date, 1);
  const day = new Date(`${date}T12:00:00`);
  const saturdayDistance = ((6 - day.getDay() + 7) % 7) || 7;
  const weekend = addDays(date, saturdayDistance);
  const candidates = tasks.filter((task) => !["done", "dropped"].includes(task.status) && (task.plannedDate === tomorrow || !task.plannedDate)).slice(0, 10);

  const applyDecisions = () => {
    const now = new Date().toISOString();
    mutateTasks((current) => current.map((task) => {
      const decision = decisions[task.id];
      if (!decision) return task;
      const withReschedule = (newDate: string, newTime: string | null) => ({
        rescheduleCount: task.rescheduleCount + (task.plannedDate || task.startTime ? 1 : 0),
        rescheduleHistory: task.plannedDate || task.startTime ? [...task.rescheduleHistory, { oldDate: task.plannedDate, oldTime: task.startTime, newDate, newTime, changedAt: now }] : task.rescheduleHistory,
        lastRescheduledAt: task.plannedDate || task.startTime ? now : task.lastRescheduledAt,
      });
      if (decision === "tomorrow") return { ...task, plannedDate: tomorrow, startTime: keepTime[task.id] ? task.startTime : null, dayPart: keepTime[task.id] ? task.dayPart : null, isMustWin: false, status: "todo", source: "end_day", updatedAt: now, ...withReschedule(tomorrow, keepTime[task.id] ? task.startTime : null) };
      if (decision === "weekend") return { ...task, plannedDate: weekend, startTime: null, dayPart: null, isMustWin: false, status: "todo", source: "end_day", updatedAt: now, ...withReschedule(weekend, null) };
      if (decision === "waiting") return { ...task, status: "waiting", waitingFor: waitingDetails[task.id] || task.waitingFor, focusTimerStatus: "paused", source: "end_day", updatedAt: now };
      return { ...task, status: "dropped", isMustWin: false, archivedAt: now, focusTimerStatus: "paused", source: "end_day", updatedAt: now };
    }));
    const records = JSON.parse(window.localStorage.getItem(END_DAY_KEY) || "{}");
    records[date] = {
      ...(records[date] || {}), date, completedTaskIds: done.map((task) => task.id),
      unresolvedDecisions: unresolved.filter((task) => !decisions[task.id]).map((task) => task.id),
      movedToTomorrowTaskIds: unresolved.filter((task) => decisions[task.id] === "tomorrow").map((task) => task.id),
      movedToWeekendTaskIds: unresolved.filter((task) => decisions[task.id] === "weekend").map((task) => task.id),
      waitingTaskIds: unresolved.filter((task) => decisions[task.id] === "waiting").map((task) => task.id),
      abandonedTaskIds: unresolved.filter((task) => decisions[task.id] === "drop").map((task) => task.id),
      totalFocusSeconds: totalFocus,
    };
    window.localStorage.setItem(END_DAY_KEY, JSON.stringify(records));
    setStep(3);
  };

  const finishTomorrow = () => {
    const now = new Date().toISOString();
    const time = timePreset === "none" ? null : timePreset === "custom" ? customTime : timePreset;
    let chosenId = tomorrowMustWin;
    mutateTasks((current) => {
      let next = current.map((task) => task.plannedDate === tomorrow ? { ...task, isMustWin: false, updatedAt: now } : task);
      if (newTomorrowTitle.trim()) {
        const created = normalizeTask({ id: makeId("task"), title: newTomorrowTitle.trim(), plannedDate: tomorrow, startTime: time, dayPart: time ? partFromTime(time) : null, isMustWin: true, source: "end_day" });
        chosenId = created.id;
        next = [created, ...next];
      } else if (tomorrowMustWin) {
        next = next.map((task) => task.id === tomorrowMustWin ? { ...task, plannedDate: tomorrow, startTime: time, dayPart: time ? partFromTime(time) : null, isMustWin: true, status: task.status === "waiting" ? "waiting" : "todo", source: "end_day", updatedAt: now } : task);
      }
      return next;
    });
    const records = JSON.parse(window.localStorage.getItem(END_DAY_KEY) || "{}");
    records[date] = { ...(records[date] || {}), date, tomorrowMustWinTaskId: chosenId || null, completedAt: now };
    window.localStorage.setItem(END_DAY_KEY, JSON.stringify(records));
    setStep(4);
  };

  const mustWinCopy = !mustWin ? "Hôm nay chưa chọn việc phải thắng. Mai mình thử chọn một việc nhé." : mustWin.status === "done" ? "Ngày hôm nay có một chiến thắng thật." : "Không sao. Quan trọng là mình quyết định rõ việc này sẽ đi đâu tiếp.";

  return <div className="modal-backdrop centered end-wizard-backdrop" role="presentation"><section className="end-day-wizard" role="dialog" aria-modal="true" aria-labelledby="end-day-title">
    <header><div><span>KẾT NGÀY · BƯỚC {Math.min(step, 3)}/3</span><div className="wizard-progress"><i className={step >= 1 ? "active" : ""} /><i className={step >= 2 ? "active" : ""} /><i className={step >= 3 ? "active" : ""} /></div></div><button className="close" onClick={onClose} aria-label="Đóng">×</button></header>
    {step === 1 && <div className="wizard-step"><span className="wizard-kicker">NHÌN LẠI</span><h2 id="end-day-title">Hôm nay đã đi được đến đâu?</h2><p className="end-date">{formatDate(date)}</p>{!dayTasks.length ? <div className="wizard-empty"><h3>Hôm nay chưa có việc nào được cam kết.</h3><p>Không sao, mình có thể chuẩn bị một việc cho ngày mai.</p></div> : <><div className="end-win"><small>VIỆC PHẢI THẮNG</small><strong>{mustWin ? mustWin.title : "Chưa có việc phải thắng"}</strong><span>{mustWinCopy}</span></div><div className="end-stats"><div><strong>{done.length}</strong><span>việc đã xong</span></div><div><strong>{unresolved.length}</strong><span>việc cần quyết định</span></div><div><strong>{totalFocus ? formatDuration(Math.round(totalFocus / 60)) : "—"}</strong><span>tổng thời gian focus</span></div></div><div className="end-lists">{stuck.length > 0 && <section><span>BỊ KẸT</span>{stuck.map((task) => <p key={task.id}>• {task.title}</p>)}</section>}{waiting.length > 0 && <section><span>ĐANG CHỜ</span>{waiting.map((task) => <p key={task.id}>• {task.title}{task.waitingFor ? ` — ${task.waitingFor}` : ""}</p>)}</section>}</div></>}<footer><button onClick={onClose}>Quay lại Ngày của tôi</button><button className="primary" onClick={() => setStep(2)}>{dayTasks.length ? "Tiếp tục" : "Chuẩn bị ngày mai"}</button></footer></div>}

    {step === 2 && <div className="wizard-step"><span className="wizard-kicker">QUYẾT ĐỊNH VIỆC CHƯA XONG</span><h2 id="end-day-title">Mỗi việc sẽ đi đâu tiếp?</h2><p>Không có việc nào tự trôi. Bạn chỉ cần đưa ra một quyết định rõ.</p>{unresolved.length ? <div className="decision-list">{unresolved.map((task) => <article key={task.id}><div><h3>{task.title}</h3><p>{task.startTime || "Chưa cam kết giờ"} · {STATUS_LABEL[task.status]} · {task.valueGroup}</p></div><div className="decision-choices">{[["tomorrow","Chuyển sang mai"],["weekend","Để cuối tuần"],["waiting","Đang chờ"],["drop","Bỏ"]].map(([key,label]) => <button key={key} className={decisions[task.id] === key ? "chosen" : ""} onClick={() => setDecisions({ ...decisions, [task.id]: key as typeof decisions[string] })}>{label}</button>)}</div>{decisions[task.id] === "tomorrow" && task.startTime && <label className="inline-check"><input type="checkbox" checked={Boolean(keepTime[task.id])} onChange={(event) => setKeepTime({ ...keepTime, [task.id]: event.target.checked })} /> Giữ giờ {task.startTime} cho ngày mai</label>}{decisions[task.id] === "waiting" && <input value={waitingDetails[task.id] || ""} onChange={(event) => setWaitingDetails({ ...waitingDetails, [task.id]: event.target.value })} placeholder="Bạn đang chờ ai hoặc điều gì?" />}</article>)}</div> : <div className="wizard-empty"><h3>Không còn việc nào cần quyết định hôm nay.</h3><p>Mọi việc đã có một chỗ rõ ràng.</p></div>}<p className="decision-note">{unresolved.filter((task) => !decisions[task.id]).length ? `Còn ${unresolved.filter((task) => !decisions[task.id]).length} việc chưa có quyết định.` : "Mọi việc đã có quyết định."}</p><footer><button onClick={() => setStep(1)}>Quay lại</button><button className="primary" onClick={applyDecisions}>Áp dụng và tiếp tục</button></footer></div>}

    {step === 3 && <div className="wizard-step"><span className="wizard-kicker">CHUẨN BỊ NGÀY MAI</span><h2 id="end-day-title">Ngày mai bạn muốn thắng việc gì?</h2><p>Chọn một việc từ danh sách ngắn hoặc tạo một việc mới.</p><div className="tomorrow-picker">{candidates.length ? candidates.map((task) => <button key={task.id} className={tomorrowMustWin === task.id ? "chosen" : ""} onClick={() => { setTomorrowMustWin(task.id); setNewTomorrowTitle(""); }}><span>{task.plannedDate === tomorrow ? "ĐÃ Ở NGÀY MAI" : "TỪ BACKLOG"}</span><strong>{task.title}</strong></button>) : <p>Backlog đang trống. Bạn có thể tạo một việc mới cho ngày mai.</p>}</div><label className="new-tomorrow">Hoặc tạo việc mới<input value={newTomorrowTitle} onChange={(event) => { setNewTomorrowTitle(event.target.value); setTomorrowMustWin(""); }} placeholder="Việc đáng thắng ngày mai là gì?" /></label><fieldset className="tomorrow-time"><legend>Đặt giờ nhanh</legend>{[["09:00","Sáng 09:00"],["14:00","Chiều 14:00"],["custom","Giờ khác"],["none","Chưa đặt giờ"]].map(([key,label]) => <button key={key} className={timePreset === key ? "chosen" : ""} onClick={() => setTimePreset(key as typeof timePreset)}>{label}</button>)}</fieldset>{timePreset === "custom" && <input className="custom-tomorrow-time" value={customTime} onChange={(event) => setCustomTime(event.target.value)} placeholder="16:30" />}<footer><button onClick={() => setStep(2)}>Quay lại</button><button className="primary" onClick={finishTomorrow}>{tomorrowMustWin || newTomorrowTitle.trim() ? "Chọn việc phải thắng" : "Hoàn tất, chọn sau"}</button></footer></div>}

    {step === 4 && <div className="wizard-finish"><div className="finish-orb">☾</div><span>NGÀY HÔM NAY ĐÃ KHÉP LẠI</span><h2 id="end-day-title">Chúc bạn một buổi tối nhẹ.</h2><p>{tomorrowMustWin || newTomorrowTitle.trim() ? "Ngày mai đã có một việc đáng để bắt đầu." : "Ngày mai chưa có việc phải thắng. Bạn có thể chọn sau."}</p><a href="/admin/ngay-cua-toi">Về Ngày của tôi</a></div>}
  </section></div>;
}

function TaskRow({ task, onStart, onComplete, onSchedule, onStuck, onDrop }: { task: Task; onStart: (task: Task) => void; onComplete: (task: Task) => void; onSchedule: (task: Task, mustWin?: boolean) => void; onStuck: (task: Task) => void; onDrop: (task: Task) => void }) {
  return <div className={`task-row status-${task.status}`}>
    <time>{task.startTime}</time><div className="task-main"><div><h3>{task.title}</h3>{task.isMustWin && <span className="tiny-win">Việc phải thắng</span>}</div><p>{formatDuration(task.durationMinutes)} · <span className="group-text">{task.valueGroup}</span>{task.status !== "todo" && <> · {STATUS_LABEL[task.status]}</>}</p></div>
    <div className="row-actions">
      {task.status === "todo" && <button className="start" onClick={() => onStart(task)}>Bắt đầu</button>}
      {task.status === "doing" && <button className="start" onClick={() => onStart(task)}>Tiếp tục</button>}
      {task.status === "stuck" && <button className="start" onClick={() => onComplete(task)}>Hoàn thành</button>}
      {task.status !== "done" && <button onClick={() => onSchedule(task)}>Đổi giờ</button>}
      {task.status !== "done" && <details><summary aria-label="Thêm hành động">•••</summary><div><button onClick={() => onStuck(task)}>Bị kẹt</button><button onClick={() => onDrop(task)}>Bỏ việc</button></div></details>}
      {task.status === "done" && <span className="done-mark">✓ Đã xong</span>}
    </div>
  </div>;
}

function SchedulePanel({ draft, task, today, onChange, onClose, onCommit, existingMustWin }: { draft: ScheduleDraft; task: Task; today: string; onChange: (draft: ScheduleDraft) => void; onClose: () => void; onCommit: () => void; existingMustWin: boolean }) {
  const set = (updates: Partial<ScheduleDraft>) => onChange({ ...draft, ...updates });
  const times: Record<DayPart, string[]> = { morning: ["09:00", "10:30"], afternoon: ["14:00", "16:00"], evening: ["20:00"] };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="schedule-panel" role="dialog" aria-modal="true" aria-labelledby="schedule-title">
      <header><div><span>ĐẶT VÀO LỊCH</span><h2 id="schedule-title">Cam kết một thời gian thật</h2><p>{task.title}</p></div><button className="close" onClick={onClose} aria-label="Đóng">×</button></header>
      <div className="schedule-body">
        <ChoiceGroup label="Làm ngày nào?"><button className={draft.dateMode === "today" ? "chosen" : ""} onClick={() => set({ dateMode: "today", customDate: today })}>Hôm nay</button><button className={draft.dateMode === "tomorrow" ? "chosen" : ""} onClick={() => set({ dateMode: "tomorrow" })}>Ngày mai</button><button className={draft.dateMode === "monday" ? "chosen" : ""} onClick={() => set({ dateMode: "monday" })}>Thứ Hai tới</button><button className={draft.dateMode === "custom" ? "chosen" : ""} onClick={() => set({ dateMode: "custom" })}>Ngày khác</button></ChoiceGroup>
        {draft.dateMode === "custom" && <label className="field-label">Chọn ngày<input type="date" min={today} value={draft.customDate} onChange={(event) => set({ customDate: event.target.value })} /></label>}
        <ChoiceGroup label="Vào buổi nào?"><button className={draft.dayPart === "morning" ? "chosen" : ""} onClick={() => set({ dayPart: "morning", time: "09:00" })}>Sáng</button><button className={draft.dayPart === "afternoon" ? "chosen" : ""} onClick={() => set({ dayPart: "afternoon", time: "14:00" })}>Chiều</button><button className={draft.dayPart === "evening" ? "chosen" : ""} onClick={() => set({ dayPart: "evening", time: "20:00" })}>Tối</button></ChoiceGroup>
        <ChoiceGroup label="Bắt đầu lúc mấy giờ?">{times[draft.dayPart].map((time) => <button key={time} className={draft.time === time ? "chosen" : ""} onClick={() => set({ time })}>{time}</button>)}<label className="time-input">Giờ khác<input value={draft.time} onChange={(event) => { const time = event.target.value; set({ time, dayPart: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? partFromTime(time) : draft.dayPart }); }} placeholder="14:30" /></label></ChoiceGroup>
        {!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time) && <p className="validation-note">Chọn giờ theo dạng 09:00 hoặc 14:30.</p>}
        <ChoiceGroup label="Dự kiến mất bao lâu?">{[15, 25, 45, 90].map((duration) => <button key={duration} className={draft.duration === duration ? "chosen" : ""} onClick={() => set({ duration })}>{duration === 90 ? "90 phút" : `${duration} phút`}</button>)}</ChoiceGroup>
        <label className="field-label">Nhóm giá trị <span>Không bắt buộc</span><select value={draft.valueGroup} onChange={(event) => set({ valueGroup: event.target.value as ValueGroup })}>{["Doanh thu", "Khách hàng", "Chiến lược", "Vận hành", "Cá nhân", "Khác"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="must-win-toggle"><input type="checkbox" checked={draft.isMustWin} onChange={(event) => set({ isMustWin: event.target.checked })} /><span><strong>Đây là việc phải thắng hôm nay</strong><small>Mỗi ngày chỉ có một việc.</small></span></label>
        {draft.isMustWin && existingMustWin && <p className="replace-note">Hôm đó đã có một việc phải thắng. Cam kết việc này sẽ thay thế việc cũ.</p>}
      </div>
      <footer><button onClick={onClose}>Hủy</button><button className="primary" disabled={!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time) || (draft.dateMode === "custom" && !draft.customDate)} onClick={onCommit}>{task.startTime ? "Cập nhật cam kết" : "Cam kết"}</button></footer>
    </section>
  </div>;
}

function ChoiceGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <fieldset className="choice-group"><legend>{label}</legend><div>{children}</div></fieldset>;
}
