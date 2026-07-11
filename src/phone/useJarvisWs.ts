import { useEffect, useRef, useState, useCallback } from "react";

export interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  ts?: number;
}

interface UseJarvisWsReturn {
  connected: boolean;
  lastMessage: WsMessage | null;
  send: (type: string, payload?: unknown) => boolean;
  sendBinary: (buf: ArrayBuffer) => boolean;
}

const RECONNECT_DELAY_MS = 4000;

export function useJarvisWs(token: string | null, wsUrl?: string): UseJarvisWsReturn {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const connect = useCallback(() => {
    if (!token || stoppedRef.current) return;
    const ws = new WebSocket(wsUrl ?? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/mesh/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as WsMessage;
        if (msg.type === "auth_ok") setConnected(true);
        setLastMessage(msg);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!stoppedRef.current) {
        retryRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror
    };
  }, [token]);

  useEffect(() => {
    stoppedRef.current = false;
    connect();
    return () => {
      stoppedRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [connect]);

  const send = useCallback((type: string, payload?: unknown): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const sendBinary = useCallback((buf: ArrayBuffer): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(buf);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { connected, lastMessage, send, sendBinary };
}
