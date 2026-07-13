"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BlockConversationDialog } from "./block-conversation-dialog";
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
import { useVisiblePoller } from "./use-visible-poller";

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

function sortConversations(items: ConversationItem[]) {
  return items.toSorted((left, right) => {
    const activityDifference = new Date(right.activityAt).getTime() - new Date(left.activityAt).getTime();
    return activityDifference || left.id.localeCompare(right.id);
  });
}

function mergeConversations(current: ConversationItem[], incoming: ConversationItem[]) {
  const conversations = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = conversations.get(item.id);
    conversations.set(item.id, existing ? { ...item, blocked: existing.blocked || item.blocked } : item);
  }
  return sortConversations([...conversations.values()]);
}

function mergeMessages(current: DisplayMessage[], incoming: ChatMessage[]) {
  const messages = new Map(current.map((item) => [item.clientMessageId, item]));
  for (const item of incoming) messages.set(item.clientMessageId, item);
  return [...messages.values()].sort((left, right) => {
    const timeDifference = new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
}

function unreadCounterpartIds(items: ChatMessage[]) {
  return [...new Set(items.filter((item) => !item.mine && item.readAt === null).map(({ id }) => id))];
}

export function ChatWorkspace({ realm }: { realm: ChatRealm }) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [conversationState, setConversationState] = useState<"loading" | "ready" | "error">("loading");
  const [conversationReload, setConversationReload] = useState(0);
  const [conversationNextCursor, setConversationNextCursor] = useState<string | null>(null);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [conversationPollEpoch, setConversationPollEpoch] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [threadState, setThreadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [beforeCursor, setBeforeCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [messagePollEpoch, setMessagePollEpoch] = useState(0);
  const [canPollMessages, setCanPollMessages] = useState(false);
  const [conversationReadyRealm, setConversationReadyRealm] = useState<ChatRealm | null>(null);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const threadHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const blockTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusIntent = useRef<"list" | "thread" | null>(null);
  const restoreBlockFocus = useRef(false);
  const conversationGeneration = useRef(0);
  const conversationFirstPageCursor = useRef<string | null>(null);
  const conversationLoadedPageCount = useRef(1);
  const conversationPaginationRevision = useRef(0);
  const conversationPageController = useRef<AbortController | null>(null);
  const threadGeneration = useRef(0);
  const historyController = useRef<AbortController | null>(null);
  const olderController = useRef<AbortController | null>(null);
  const readControllers = useRef(new Set<AbortController>());
  const blockController = useRef<AbortController | null>(null);
  const sendControllers = useRef(new Map<string, AbortController>());
  const changesCursor = useRef<string | null>(null);

  const selectedConversation = conversations.find(({ id }) => id === selectedId) ?? null;

  const abortReadRequests = useCallback(() => {
    for (const controller of readControllers.current) controller.abort();
    readControllers.current.clear();
  }, []);

  useEffect(() => {
    const generation = ++conversationGeneration.current;
    conversationPageController.current?.abort();
    conversationLoadedPageCount.current = 1;
    conversationPaginationRevision.current += 1;
    const controller = new AbortController();
    void fetch(`/api/conversations?realm=${realm}&limit=100`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(responseJson<ConversationPage>).then((page) => {
      if (generation !== conversationGeneration.current) return;
      const sorted = sortConversations(page.items);
      conversationFirstPageCursor.current = page.nextCursor;
      setConversations(sorted);
      setConversationNextCursor(page.nextCursor);
      setLoadingMoreConversations(false);
      setMessages([]);
      setBeforeCursor(null);
      setOlderError(false);
      setMessagePollEpoch(0);
      setThreadState(sorted.length > 0 ? "loading" : "idle");
      setSelectedId(sorted[0]?.id ?? null);
      setMobileView(sorted.length > 0 ? "thread" : "list");
      setConversationState("ready");
      setConversationReadyRealm(realm);
      setConversationPollEpoch((value) => value + 1);
    }).catch((error: unknown) => {
      if (generation === conversationGeneration.current && !isAbortError(error)) {
        setConversationReadyRealm(null);
        setConversationState("error");
      }
    });
    return () => controller.abort();
  }, [conversationReload, realm]);

  const pollConversations = useCallback(async (signal: AbortSignal) => {
    const generation = conversationGeneration.current;
    const response = await fetch(`/api/conversations?realm=${realm}&limit=100`, { cache: "no-store", signal });
    const page = await responseJson<ConversationPage>(response);
    if (generation !== conversationGeneration.current) return { hasMore: false };
    setConversations((current) => mergeConversations(current, page.items));
    const boundaryChanged = conversationFirstPageCursor.current !== page.nextCursor;
    conversationFirstPageCursor.current = page.nextCursor;
    if (conversationLoadedPageCount.current === 1) {
      setConversationNextCursor(page.nextCursor);
    } else if (boundaryChanged) {
      conversationPaginationRevision.current += 1;
      setConversationNextCursor(page.nextCursor);
    }
    return { hasMore: false };
  }, [realm]);

  useVisiblePoller({
    enabled: conversationState === "ready" && conversationReadyRealm === realm && conversationPollEpoch > 0,
    generation: conversationPollEpoch,
    pull: pollConversations,
  });

  const markRead = useCallback((conversationId: string, generation: number, pageItems: ChatMessage[]) => {
    const messageIds = unreadCounterpartIds(pageItems);
    if (messageIds.length === 0) return;
    const controller = new AbortController();
    readControllers.current.add(controller);
    void fetch(`/api/conversations/${conversationId}/read?realm=${realm}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageIds }),
      signal: controller.signal,
    }).then(responseJson<{ readCount: number; readAt: string }>).then((result) => {
      if (generation !== threadGeneration.current) return;
      const visibleIds = new Set(messageIds);
      setMessages((items) => items.map((item) => visibleIds.has(item.id) && !item.mine && item.readAt === null
        ? { ...item, readAt: result.readAt }
        : item));
      setConversations((items) => items.map((item) => item.id === conversationId
        ? { ...item, unreadCount: Math.max(0, item.unreadCount - result.readCount) }
        : item));
    }).catch(() => undefined).finally(() => readControllers.current.delete(controller));
  }, [realm]);

  useEffect(() => {
    historyController.current?.abort();
    olderController.current?.abort();
    abortReadRequests();
    blockController.current?.abort();
    for (const controller of sendControllers.current.values()) controller.abort();
    sendControllers.current.clear();
    const generation = ++threadGeneration.current;
    changesCursor.current = null;
    queueMicrotask(() => {
      if (generation !== threadGeneration.current) return;
      setBlockDialogOpen(false);
      setBlockBusy(false);
      setBlockError(null);
      setOlderError(false);
      setCanPollMessages(false);
      setMessagePollEpoch(0);
    });
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
      changesCursor.current = page.nextChangesCursor;
      setCanPollMessages(Boolean(page.nextChangesCursor));
      setThreadState("ready");
      setMessagePollEpoch((value) => value + 1);
      markRead(selectedId, generation, page.items);
    }).catch((error: unknown) => {
      if (generation === threadGeneration.current && !isAbortError(error)) setThreadState("error");
    });
    return () => controller.abort();
  }, [abortReadRequests, markRead, realm, selectedId]);

  const pollMessages = useCallback(async (signal: AbortSignal) => {
    const conversationId = selectedId;
    const cursor = changesCursor.current;
    const generation = threadGeneration.current;
    if (!conversationId || !cursor) return { hasMore: false };
    const response = await fetch(
      `/api/conversations/${conversationId}/messages?realm=${realm}&limit=100&changesAfter=${encodeURIComponent(cursor)}`,
      { cache: "no-store", signal },
    );
    const page = await responseJson<MessagePage>(response);
    if (generation !== threadGeneration.current) return { hasMore: false };
    setMessages((items) => mergeMessages(items, page.items));
    changesCursor.current = page.nextChangesCursor ?? cursor;
    markRead(conversationId, generation, page.items);
    const newest = page.items.toSorted((left, right) => {
      const difference = new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime();
      return difference || right.id.localeCompare(left.id);
    })[0];
    if (newest) {
      setConversations((items) => sortConversations(items.map((item) => {
        if (item.id !== conversationId) return item;
        const currentAt = item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : Number.NEGATIVE_INFINITY;
        return new Date(newest.sentAt).getTime() > currentAt
          ? { ...item, activityAt: newest.sentAt, lastMessageAt: newest.sentAt }
          : item;
      })));
    }
    return { hasMore: page.hasMore };
  }, [markRead, realm, selectedId]);

  useVisiblePoller({
    enabled: Boolean(selectedId && canPollMessages && messagePollEpoch > 0),
    generation: messagePollEpoch,
    pull: pollMessages,
  });

  useEffect(() => {
    const intent = focusIntent.current;
    if (!intent) return;
    focusIntent.current = null;
    if (intent === "thread") {
      threadHeadingRef.current?.focus();
      return;
    }
    const button = [...(workspaceRef.current?.querySelectorAll<HTMLButtonElement>("[data-conversation-id]") ?? [])]
      .find((candidate) => candidate.dataset.conversationId === selectedId);
    button?.focus();
  }, [mobileView, selectedId]);

  useEffect(() => {
    if (!blockDialogOpen && restoreBlockFocus.current) {
      restoreBlockFocus.current = false;
      blockTriggerRef.current?.focus();
    }
  }, [blockDialogOpen, selectedConversation?.blocked]);

  useEffect(() => () => {
    conversationPageController.current?.abort();
    historyController.current?.abort();
    olderController.current?.abort();
    blockController.current?.abort();
    abortReadRequests();
    for (const controller of sendControllers.current.values()) controller.abort();
  }, [abortReadRequests]);

  function selectConversation(id: string) {
    focusIntent.current = "thread";
    if (id === selectedId) {
      setMobileView("thread");
      return;
    }
    historyController.current?.abort();
    olderController.current?.abort();
    abortReadRequests();
    setMessages([]);
    setBeforeCursor(null);
    setLoadingOlder(false);
    setOlderError(false);
    setCanPollMessages(false);
    setMessagePollEpoch(0);
    setThreadState("loading");
    setSelectedId(id);
    setMobileView("thread");
  }

  function backToConversationList() {
    focusIntent.current = "list";
    setMobileView("list");
  }

  async function loadMoreConversations() {
    if (!conversationNextCursor || loadingMoreConversations) return;
    const cursor = conversationNextCursor;
    const generation = conversationGeneration.current;
    const revision = conversationPaginationRevision.current;
    // Deep-page membership can change even when page 1 and its boundary cursor are identical.
    const rebuild = conversationLoadedPageCount.current > 1;
    const targetPageCount = conversationLoadedPageCount.current + 1;
    const controller = new AbortController();
    conversationPageController.current?.abort();
    conversationPageController.current = controller;
    setLoadingMoreConversations(true);
    try {
      let nextCursor: string | null = rebuild ? conversationFirstPageCursor.current : cursor;
      const incoming: ConversationItem[] = [];
      let loadedPageCount = rebuild ? 1 : conversationLoadedPageCount.current;
      const pagesToFetch = rebuild ? targetPageCount - 1 : 1;
      for (let pageIndex = 0; pageIndex < pagesToFetch && nextCursor; pageIndex += 1) {
        const response = await fetch(
          `/api/conversations?realm=${realm}&limit=100&cursor=${encodeURIComponent(nextCursor)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const page = await responseJson<ConversationPage>(response);
        incoming.push(...page.items);
        nextCursor = page.nextCursor;
        loadedPageCount += 1;
      }
      if (
        generation !== conversationGeneration.current
        || revision !== conversationPaginationRevision.current
      ) return;
      // This count and next cursor describe only the freshly traversed chain. The ID merge
      // intentionally preserves known conversations and the current selection.
      conversationLoadedPageCount.current = loadedPageCount;
      setConversations((current) => mergeConversations(current, incoming));
      setConversationNextCursor(nextCursor);
    } catch (error) {
      if (generation !== conversationGeneration.current || isAbortError(error)) return;
    } finally {
      if (generation === conversationGeneration.current) setLoadingMoreConversations(false);
    }
  }

  async function loadOlder() {
    if (!selectedId || !beforeCursor || loadingOlder) return;
    const conversationId = selectedId;
    const generation = threadGeneration.current;
    const requestedCursor = beforeCursor;
    const controller = new AbortController();
    olderController.current?.abort();
    olderController.current = controller;
    setOlderError(false);
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/messages?realm=${realm}&limit=50&before=${encodeURIComponent(requestedCursor)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const page = await responseJson<MessagePage>(response);
      if (generation !== threadGeneration.current) return;
      setMessages((items) => mergeMessages(items, page.items));
      setBeforeCursor(page.nextBeforeCursor);
      markRead(conversationId, generation, page.items);
    } catch (error) {
      if (generation === threadGeneration.current && !isAbortError(error)) setOlderError(true);
    } finally {
      if (generation === threadGeneration.current) setLoadingOlder(false);
    }
  }

  async function sendMessage(clientMessageId: string, body: string, append: boolean) {
    if (!selectedId || selectedConversation?.blocked) return;
    const conversationId = selectedId;
    const generation = threadGeneration.current;
    const sentAt = new Date().toISOString();
    const optimistic: DisplayMessage = {
      id: `optimistic-${clientMessageId}`,
      clientMessageId,
      body,
      sentAt,
      readAt: null,
      editedAt: null,
      deletedAt: null,
      updatedAt: sentAt,
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
      setConversations((items) => sortConversations(items.map((item) => item.id === conversationId
        ? { ...item, activityAt: result.message.sentAt, lastMessageAt: result.message.sentAt }
        : item)));
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

  function closeBlockDialog() {
    if (blockBusy) return;
    restoreBlockFocus.current = true;
    setBlockDialogOpen(false);
    setBlockError(null);
  }

  async function blockConversation(reason: string) {
    if (!selectedId || blockBusy) return;
    const conversationId = selectedId;
    const generation = threadGeneration.current;
    const controller = new AbortController();
    blockController.current?.abort();
    blockController.current = controller;
    setBlockBusy(true);
    setBlockError(null);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/block?realm=${realm}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
        signal: controller.signal,
      });
      await responseJson<{ blocked: true }>(response);
      if (generation !== threadGeneration.current) return;
      setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, blocked: true } : item));
      restoreBlockFocus.current = true;
      setBlockDialogOpen(false);
    } catch (error) {
      if (generation === threadGeneration.current && !isAbortError(error)) {
        setBlockError(error instanceof Error ? error.message : "屏蔽失败，请重试");
      }
    } finally {
      if (generation === threadGeneration.current) setBlockBusy(false);
    }
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
            setConversationReadyRealm(null);
            setConversationPollEpoch(0);
            setConversationReload((value) => value + 1);
          }} type="button">
            重新加载
          </button>
        </div>
      ) : null}
      {conversationState === "ready" ? (
        <div className="chat-workspace" data-mobile-view={mobileView} data-testid="chat-workspace" ref={workspaceRef}>
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
                  blockTriggerRef={blockTriggerRef}
                  conversation={selectedConversation}
                  headingRef={threadHeadingRef}
                  loading={threadState === "loading"}
                  loadingOlder={loadingOlder}
                  messages={messages}
                  olderError={olderError}
                  onBack={backToConversationList}
                  onBlock={() => {
                    setBlockError(null);
                    setBlockDialogOpen(true);
                  }}
                  onLoadOlder={() => { void loadOlder(); }}
                  onRetry={retryMessage}
                />
                {threadState === "error" ? (
                  <p className="chat-thread__error" role="alert">部分消息读取失败，请切换会话后重试。</p>
                ) : null}
                <MessageComposer
                  disabled={threadState !== "ready" || selectedConversation.blocked}
                  onSend={(body) => { void sendMessage(crypto.randomUUID(), body, true); }}
                />
                <BlockConversationDialog
                  busy={blockBusy}
                  error={blockError}
                  onClose={closeBlockDialog}
                  onConfirm={(reason) => { void blockConversation(reason); }}
                  open={blockDialogOpen}
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
