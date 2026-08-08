/**
 * 飞书事件类型定义
 */
export interface FeishuMention {
  key: string;
  id: { open_id?: string; user_id?: string };
  name: string;
  tenant_key?: string;
}

export interface FeishuMessage {
  message_id: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  message_type: "text" | "post" | "image" | string;
  content: { text?: string; [key: string]: unknown };
  sender: { sender_id: { open_id: string }; sender_type: string };
  mentions?: FeishuMention[];
  create_time?: number;
}

export interface FeishuEvent {
  schema: string;
  header: { event_type: string; app_id: string; [key: string]: unknown };
  event: {
    type?: string;
    message?: FeishuMessage;
    sender?: { sender_id: { open_id: string } };
  };
  challenge?: string;
  token?: string;
}
