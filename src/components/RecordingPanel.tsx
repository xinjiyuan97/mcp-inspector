import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Circle, Square, Play, Download, Trash2, ArrowRight, ArrowLeft } from "lucide-react";
import { clsx } from "clsx";
import { useServerStore } from "../store/serverStore";
import { useI18n } from "../i18n";
import JsonViewer from "./JsonViewer";
import type { RecordedMessage, SessionRecording } from "../types";

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function RecordingPanel() {
  const { t } = useI18n();
  const { servers, activeServerId } = useServerStore();
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  const [replayMessages, setReplayMessages] = useState<RecordedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);

  const server = activeServerId ? servers[activeServerId] : null;
  const isRecording = activeRecordingId !== null;

  const loadRecordings = useCallback(async () => {
    try {
      const list = await invoke<SessionRecording[]>("list_recordings");
      setRecordings(list);
    } catch (e) {
      alert(`${t("recording.loadFailed")}: ${e}`);
    }
  }, [t]);

  useEffect(() => {
    void loadRecordings();
  }, [loadRecordings]);

  const handleStartRecording = async () => {
    if (!server) {
      alert(t("recording.noServer"));
      return;
    }

    setLoading(true);
    try {
      const id = await invoke<string>("start_recording", {
        serverId: server.config.id,
        serverName: server.config.name,
      });
      setActiveRecordingId(id);
    } catch (e) {
      alert(`${t("recording.startFailed")}: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStopRecording = async () => {
    setLoading(true);
    try {
      const recording = await invoke<SessionRecording>("stop_recording");
      setActiveRecordingId(null);
      setRecordings((prev) => [recording, ...prev.filter((item) => item.id !== recording.id)]);
      await loadRecordings();
    } catch (e) {
      alert(`${t("recording.stopFailed")}: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReplay = async (id: string) => {
    setReplayingId(id);
    try {
      const messages = await invoke<RecordedMessage[]>("replay_recording", { id });
      setSelectedReplayId(id);
      setReplayMessages(messages);
    } catch (e) {
      alert(`${t("recording.replayFailed")}: ${e}`);
    } finally {
      setReplayingId(null);
    }
  };

  const handleExport = async (recording: SessionRecording) => {
    try {
      const raw = await invoke<string>("export_recording", { id: recording.id });
      const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${recording.name || recording.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`${t("recording.exportFailed")}: ${e}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_recording", { id });
      if (selectedReplayId === id) {
        setSelectedReplayId(null);
        setReplayMessages([]);
      }
      await loadRecordings();
    } catch (e) {
      alert(`${t("recording.deleteFailed")}: ${e}`);
    }
  };

  const replayCount = useMemo(() => replayMessages.length, [replayMessages]);

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-neutral-900 text-neutral-200">
      <div className="flex items-center gap-2 border-b border-neutral-700 p-3">
        {!isRecording ? (
          <button
            onClick={handleStartRecording}
            disabled={loading}
            className="flex items-center gap-2 rounded bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
          >
            <Circle size={14} />
            {t("recording.start")}
          </button>
        ) : (
          <button
            onClick={handleStopRecording}
            disabled={loading}
            className="flex items-center gap-2 rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            <Square size={14} />
            {t("recording.stop")}
          </button>
        )}

        <button
          onClick={() => void loadRecordings()}
          className="rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          {t("recording.refresh")}
        </button>

        {isRecording && (
          <span className="inline-flex items-center rounded bg-red-900/60 px-2 py-1 text-xs text-red-300">
            {t("recording.recording")}
          </span>
        )}

        {server && (
          <span className="ml-auto text-xs text-neutral-400">
            {server.config.name}
          </span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
        <div className="border-r border-neutral-700 p-3">
          <div className="mb-2 text-sm font-medium text-neutral-300">{t("recording.recordingList")}</div>
          <div className="space-y-2 overflow-y-auto pr-1">
            {recordings.length === 0 && (
              <div className="rounded border border-dashed border-neutral-700 px-3 py-8 text-center text-sm text-neutral-500">
                {t("recording.noRecordings")}
              </div>
            )}

            {recordings.map((item) => (
              <div key={item.id} className="rounded border border-neutral-700 bg-neutral-800 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-neutral-100">{item.name || item.id}</div>
                    <div className="mt-1 text-xs text-neutral-400">
                      {t("recording.startTime")}: {formatDateTime(item.started_at)}
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">
                      {t("recording.messages")}: {item.messages.length}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {item.ended_at ? formatDateTime(item.ended_at) : t("recording.inProgress")}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => void handleReplay(item.id)}
                    disabled={replayingId === item.id}
                    className="flex items-center gap-1 rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Play size={12} />
                    {t("recording.replay")}
                  </button>
                  <button
                    onClick={() => void handleExport(item)}
                    className="flex items-center gap-1 rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
                  >
                    <Download size={12} />
                    {t("recording.export")}
                  </button>
                  <button
                    onClick={() => void handleDelete(item.id)}
                    className="flex items-center gap-1 rounded border border-red-800/80 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
                  >
                    <Trash2 size={12} />
                    {t("recording.delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium text-neutral-300">{t("recording.replayTitle")}</div>
            <div className="text-xs text-neutral-500">{t("recording.messages")}: {replayCount}</div>
          </div>

          {replayMessages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-neutral-700 text-sm text-neutral-500">
              {t("recording.noReplay")}
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto pr-1">
              {replayMessages.map((message) => {
                const outbound = message.direction === "client_to_server";
                return (
                  <div
                    key={message.id}
                    className={clsx(
                      "rounded border p-2",
                      outbound ? "border-blue-800/70 bg-blue-900/20" : "border-emerald-800/70 bg-emerald-900/20"
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs text-neutral-300">
                      {outbound ? <ArrowRight size={12} className="text-blue-300" /> : <ArrowLeft size={12} className="text-emerald-300" />}
                      <span>{outbound ? "→" : "←"}</span>
                      <span>{formatDateTime(message.timestamp)}</span>
                      <span className="ml-auto text-neutral-400">
                        {message.source === "proxy" ? t("recording.proxy") : t("recording.direct")}
                      </span>
                    </div>
                    <JsonViewer value={message.content} maxHeight="220px" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
