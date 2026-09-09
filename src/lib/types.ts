export type RecipientType = "contact" | "group";

export interface WaContact {
  id: string; // jid: 5511999999999@s.whatsapp.net
  phone: string; // apenas dígitos
  name: string;
  image?: string | null;
}

export interface WaGroup {
  id: string; // jid: xxxx@g.us
  name: string;
  participants: number;
  image?: string | null;
}

export type MemberType = RecipientType | "audience";

export interface AudienceMember {
  type: MemberType;
  id: string; // jid ou id de outra lista
  name: string;
}

export interface Audience {
  id: string;
  name: string;
  description?: string;
  color: string;
  members: AudienceMember[];
  createdAt: string;
  updatedAt: string;
}

export type AttachmentKind = "image" | "video" | "audio" | "document";

export interface Attachment {
  uploadId: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Para áudios: enviar como mensagem de voz (PTT) em vez de arquivo de áudio */
  asVoice?: boolean;
}

export interface MessageDraft {
  text: string;
  attachments: Attachment[];
}

export type RecipientStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";

export interface CampaignRecipient {
  id: string; // jid
  name: string;
  type: RecipientType;
  status: RecipientStatus;
  error?: string;
  sentAt?: string;
}

export type CampaignStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

export interface CampaignSettings {
  delayMinSeconds: number;
  delayMaxSeconds: number;
}

export interface Campaign {
  id: string;
  name: string;
  message: MessageDraft;
  recipients: CampaignRecipient[];
  settings: CampaignSettings;
  status: CampaignStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Resumo de origem dos destinatários (para exibição no histórico) */
  sources: { type: MemberType; id: string; name: string }[];
}

export interface Database {
  audiences: Audience[];
  campaigns: Campaign[];
}

export interface InstanceStatus {
  connected: boolean;
  loggedIn: boolean;
  status: string;
  name?: string;
  profileName?: string;
  phone?: string;
  jid?: string;
  profilePicUrl?: string | null;
  qrcode?: string | null;
  paircode?: string | null;
}
