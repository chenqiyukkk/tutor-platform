"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ConversationList } from "./conversation-list";
import { MessageComposer } from "./message-composer";
import { MessageThread } from "./message-thread";
import type {
  ChatMessage,
  ChatRealm,
  ConversationItem,
  ConversationPage,
  DisplayMessage,
  MessagePage,
} from "./types";

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 30_000;

async function responseJson<T>(response: Response) {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "请求失败");
  }
  return response.json() as Promise<T>;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function mergeMessages(current: DisplayMessage[], incoming: ChatMessage[]) {
  const messages = new Map(current.map((item) => [item.clientMessageId, item]));
  for (const item of incoming) messages.set(item.clientMessageId, item);
  return [...messages.values()].sort((left, right) => {
    const timeDifference = new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
}

export function ChatWorkspace({ realm }: { realm: ChatRealm }) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [conversationState, setConversationState] = useState<"loading" | "ready" | "error">("loading");
  const [conversationReload, setConversationReload] = useState(0);
  const [conversationNextCursor, setConversationNextCursor] = useState<string | null>(null);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [threadState, setThreadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [beforeCursor, setBeforeCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);

  const conversationGeneration = useRef(0);
  const conversationPageController = useRef<AbortController | null>(null);
  const threadGeneration = useRef(0);
  const historyController = useRef<AbortController | null>(null);
  const olderController = useRef<AbortController | null>(null);
  const pollController = useRef<AbortController | null>(null);
  const readController = useRef<AbortController | null>(null);
  const sendControllers = useRef(new Map<string, AbortController>());
  const afterCursor = useRef<string | null>(null);

  const selectedConversation = conversations.find(({ id }) => id === selectedId) ?? null;

  useEffect(() => {
    const generation = ++conversationGeneration.current;
    conversationPageController.current?.abort();
    const controller = new AbortController();
    void fetch(`/api/conversations?realm=${realm}&limit=100`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(responseJson<ConversationPage>).then((page) => {
      if (generation !== conversationGeneration.current) return;
      setConversations(page.items);
      setConversationNextCursor(page.nextCursor);
      setLoadingMoreConversations(false);
      setMessages([]);
      setBeforeCursor(null);
      setPollEpoch(0);
      setThreadState(page.items.length > 0 ? "loading" : "idle");
      setSelectedId(page.items[0]?.id ?? null);
      setMobileView(page.items.length > 0 ? "thread" : "list");
      setConversationState("ready");
    }).catch((error: unknown) => {
      if (generation === conversationGeneration.current && !isAbortError(error)) setConversationState("error");
    });
    return () => controller.abort();
  }, [conversationReload, realm]);

  const markRead = useCallback((conversationId: string, generation: number) => {
    const controller = new AbortController();
    readController.current?.abort();
    readController.current = controller;
    void fetch(`/api/conversations/${conversationId}/read?realm=${realm}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) throw new Error("read failed");
      if (generation !== threadGeneration.current) return;
      setConversations((items) => items.map((item) => item.id === conversationId
        ? { ...item, unreadCount: 0 }
        : item));
    }).catch(() => undefined);
  }, [realm]);

  useEffect(() => {
    historyController.current?.abort();
    olderController.current?.abort();
    pollController.current?.abort();
    readController.current?.abort();
    for (const controller of sendControllers.current.values()) controller.abort();
    sendControllers.current.clear();
    const generation = ++threadGeneration.current;
    afterCursor.current = null;
    if (!selectedId) return;
    const controller = new AbortController();
    historyController.current = controller;
    void fetch(`/api/conversations/${selectedId}/messages?realm=${realm}&limit=50`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(responseJson<MessagePage>).then((page) => {
      if (generation !== threadGeneration.current) return;
      setMessages(page.items);
      setBeforeCursor(page.nextBeforeCursor);
      afterCursor.current = page.nextAfterCursor;
      setThreadState("ready");
      setPollEpoch((value) => value + 1);
      if (page.items.some((item) => !item.mine && item.readAt === null)) markRead(selectedId, generation);
    }).catch((error: unknown) => {
      if (generation === threadGeneration.current && !isAbortError(error)) setThreadState("error");
    });
    return () => controller.abort();
  }, [markRead, realm, selectedId]);

  useEffect(() => {
    if (!selectedId || pollEpoch === 0 || !afterCursor.current) return;
    const conversationId = selectedId;
    const generation = threadGeneration.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = POLL_INTERVAL_MS;

    function clearTimer() {
      if (timer) clearTimeout(timer);
      timer = null;
    }

    function schedule(milliseconds: number) {
      if (disposed || document.visibilityState !== "visible") return;
      clearTimer();
      timer = setTimeout(() => { void pull(); }, milliseconds);
    }

    async function pull() {
      if (disposed || generation !== threadGeneration.current || document.visibilityState !== "visible") return;
      const cursor = afterCursor.current;
      if (!cursor) {
        schedule(POLL_INTERVAL_MS);
        return;
      }
      const controller = new AbortController();
      pollController.current?.abort();
      pollController.current = controller;
      try {
        const response = await fetch(
          `/api/conversations/${conversationId}/messages?realm=${realm}&limit=100&after=${encodeURIComponent(cursor)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const page = await responseJson<MessagePage>(response);
        if (disposed || generation !== threadGeneration.current) return;
        setMessages((items) => mergeMessages(items, page.items));
        afterCursor.current = page.nextAfterCursor ?? cursor;
        if (page.items.some((item) => !item.mine && item.readAt === null)) markRead(conversationId, generation);
        if (page.items.length > 0) {
          const newest = page.items.at(-1)!;
          setConversations((items) => items.map((item) => item.id === conversationId
            ? { ...item, activityAt: newest.sentAt, lastMessageAt: newest.sentAt, unreadCount: 0 }
            : item));
        }
        delay = POLL_INTERVAL_MS;
        schedule(page.hasMore ? 0 : delay);
      } catch (error) {
        if (disposed || generation !== threadGeneration.current || isAbortError(error)) return;
        schedule(delay);
        delay = Math.min(delay * 2, MAX_POLL_INTERVAL_MS);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        clearTimer();
        pollController.current?.abort();
        return;
      }
      delay = POLL_INTERVAL_MS;
      clearTimer();
      void pull();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearTimer();
      pollController.current?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [markRead, pollEpoch, realm, selectedId]);

  useEffect(() => () => {
    conversationPageController.current?.abort();
    historyController.current?.abort();
    olderController.current?.abort();
    pollController.current?.abort();
    readController.current?.abort();
    for (const controller of sendControllers.current.values()) controller.abort();
  }, []);

  function selectConversation(id: string) {
    if (id === selectedId) {
      setMobileView("thread");
      return;
    }
    historyController.current?.abort();
    olderController.current?.abort();
    pollController.current?.abort();
    setMessages([]);
    setBeforeCursor(null);
    setLoadingOlder(false);
    setPollEpoch(0);
    setThreadState("loading");
    setSelectedId(id);
    setMobileView("thread");
  }

  async function loadMoreConversations() {
    if (!conversationNextCursor || loadingMoreConversations) return;
    const cursor = conversationNextCursor;
    const generation = conversationGeneration.current;
    const controller = new AbortController();
    conversationPageController.current?.abort();
    conversationPageController.current = controller;
    setLoadingMoreConversations(true);
    try {
      const response = await fetch(
        `/api/conversations?realm=${realm}&limit=100&cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const page = await responseJson<ConversationPage>(response);
      if (generation !== conversationGeneration.current) return;
      setConversations((current) => {
        const knownIds = new Set(current.map(({ id }) => id));
        const additions = page.items.filter(({ id }) => {
          if (knownIds.has(id)) return false;
          knownIds.add(id);
          return true;
        });
        return [...current, ...additions];
      });
      setConversationNextCursor(page.nextCursor);
    } catch (error) {
      if (generation !== conversationGeneration.current || isAbortError(error)) return;
    } finally {
      if (generation === conversationGeneration.current) setLoadingMoreConversations(false);
    }
  }

  async function loadOlder() {
    if (!selectedId || !beforeCursor || loadingOlder) return;
    const generation = threadGeneration.current;
    const requestedCursor = beforeCursor;
    const controller = new AbortController();
    olderController.current?.abort();
    olderController.current = controller;
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/conversations/${selectedId}/messages?realm=${realm}&limit=50&before=${encodeURIComponent(requestedCursor)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const page = await responseJson<MessagePage>(response);
      if (generation !== threadGeneration.current) return;
      setMessages((items) => mergeMessages(items, page.items));
      setBeforeCursor(page.nextBeforeCursor);
    } catch (error) {
      if (generation === threadGeneration.current && !isAbortError(error)) setThreadState("error");
    } finally {
      if (generation === threadGeneration.current) setLoadingOlder(false);
    }
  }

  async function sendMessage(clientMessageId: string, body: string, append: boolean) {
    if (!selectedId) return;
    const conversationId = selectedId;
    const generation = threadGeneration.current;
    const optimistic: DisplayMessage = {
      id: `optimistic-${clientMessageId}`,
      clientMessageId,
      body,
      sentAt: new Date().toISOString(),
      readAt: null,
      mine: true,
      delivery: "sending",
    };
    setMessages((items) => append
      ? mergeMessages(items, []).concat(optimistic)
      : items.map((item) => item.clientMessageId === clientMessageId ? { ...item, delivery: "sending" } : item));
    const controller = new AbortController();
    sendControllers.current.get(clientMessageId)?.abort();
    sendControllers.current.set(clientMessageId, controller);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages?realm=${realm}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientMessageId, body }),
        signal: controller.signal,
      });
      const result = await responseJson<{ message: ChatMessage }>(response);
      if (generation !== threadGeneration.current) return;
      setMessages((items) => mergeMessages(items, [result.message]));
      setConversations((items) => items.map((item) => item.id === conversationId
        ? { ...item, activityAt: result.message.sentAt, lastMessageAt: result.message.sentAt }
        : item));
    } catch (error) {
      if (generation === threadGeneration.current && !isAbortError(error)) {
        setMessages((items) => items.map((item) => item.clientMessageId === clientMessageId
          ? { ...item, delivery: "failed" }
          : item));
      }
    } finally {
      if (sendControllers.current.get(clientMessageId) === controller) sendControllers.current.delete(clientMessageId);
    }
  }

  function retryMessage(message: DisplayMessage) {
    void sendMessage(message.clientMessageId, message.body, false);
  }

  return (
    <section className="chat-page" aria-labelledby="chat-page-title">
      <header className="chat-page__intro">
        <p className="eyebrow">私密信笺</p>
        <h1 id="chat-page-title">站内消息</h1>
        <p>仅限已经互相确认的老师与家长。联系方式不会在会话列表中公开。</p>
      </header>

      {conversationState === "loading" ? (
        <div className="chat-page__state" role="status">正在整理会话索引…</div>
      ) : null}
      {conversationState === "error" ? (
        <div className="chat-page__state" role="alert">
          <h2>暂时无法读取消息</h2>
          <p>网络可能开了个小差，请稍后再试。</p>
          <button className="button button--outline" onClick={() => {
            setConversationState("loading");
            setConversationReload((value) => value + 1);
          }} type="button">
            重新加载
          </button>
        </div>
      ) : null}
      {conversationState === "ready" ? (
        <div className="chat-workspace" data-mobile-view={mobileView} data-testid="chat-workspace">
          <ConversationList
            conversations={conversations}
            hasMore={Boolean(conversationNextCursor)}
            loadingMore={loadingMoreConversations}
            onLoadMore={() => { void loadMoreConversations(); }}
            onSelect={selectConversation}
            selectedId={selectedId}
          />
          <div className="chat-correspondence">
            {selectedConversation ? (
              <>
                <MessageThread
                  beforeCursor={beforeCursor}
                  conversation={selectedConversation}
                  loading={threadState === "loading"}
                  loadingOlder={loadingOlder}
                  messages={messages}
                  onBack={() => setMobileView("list")}
                  onLoadOlder={() => { void loadOlder(); }}
                  onRetry={retryMessage}
                />
                {threadState === "error" ? (
                  <p className="chat-thread__error" role="alert">部分消息读取失败，请切换会话后重试。</p>
                ) : null}
                <MessageComposer
                  disabled={threadState !== "ready"}
                  onSend={(body) => { void sendMessage(crypto.randomUUID(), body, true); }}
                />
              </>
            ) : (
              <div className="chat-correspondence__empty">
                <span aria-hidden="true">信</span>
                <h2>选择一封往来</h2>
                <p>会话建立后，双方才能在这里继续沟通。</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
