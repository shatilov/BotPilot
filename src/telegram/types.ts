export type TelegramChatId = number | string;

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: Record<string, unknown>;
}

export interface TelegramUpdate extends Record<string, unknown> {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  business_message?: TelegramMessage;
  edited_business_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramChat extends Record<string, unknown> {
  id: TelegramChatId;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramUser extends Record<string, unknown> {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramFileRef extends Record<string, unknown> {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface TelegramFileInfo extends Record<string, unknown> {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramMessage extends Record<string, unknown> {
  message_id: number;
  message_thread_id?: number;
  date?: number;
  chat: TelegramChat;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  text?: string;
  caption?: string;
  animation?: TelegramFileRef;
  audio?: TelegramFileRef;
  document?: TelegramFileRef;
  photo?: TelegramFileRef[];
  sticker?: TelegramFileRef;
  video?: TelegramFileRef;
  video_note?: TelegramFileRef;
  voice?: TelegramFileRef;
  new_chat_photo?: TelegramFileRef[];
}

export interface TelegramCallbackQuery extends Record<string, unknown> {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  data?: string;
  game_short_name?: string;
}
