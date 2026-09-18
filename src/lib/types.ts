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

export interface WaParticipant {
  id: string; // jid (telefone ou @lid)
  phone: string; // apenas dígitos; vazio quando o WhatsApp oculta o número
  name: string;
  isAdmin: boolean;
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

/** Metadados do anexo (o conteúdo fica apenas em memória durante a campanha). */
export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Para áudios: enviar como mensagem de voz (PTT) em vez de arquivo de áudio */
  asVoice?: boolean;
}

export interface Attachment extends AttachmentMeta {
  /** URL pública (Vercel Blob) quando o arquivo foi enviado ao armazenamento */
  url?: string;
  /** data URI base64 (modo reserva, arquivos pequenos) */
  dataUrl?: string;
}

/** Um bloco = uma mensagem enviada em sequência (texto e/ou anexos). */
export interface MessageBlock {
  id: string;
  text: string;
  attachments: Attachment[];
}

export interface MessageDraft {
  blocks: MessageBlock[];
}

export interface StoredBlock {
  id: string;
  text: string;
  attachments: AttachmentMeta[];
}

export interface StoredMessage {
  blocks: StoredBlock[];
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

export type CampaignStatus = "scheduled" | "queued" | "running" | "completed" | "cancelled" | "failed";

export interface CampaignSettings {
  delayMinSeconds: number;
  delayMaxSeconds: number;
  /** Texto usado no lugar de {nome} quando o contato não tem nome salvo */
  nameFallback?: string;
}

export interface Campaign {
  id: string;
  name: string;
  message: StoredMessage;
  recipients: CampaignRecipient[];
  settings: CampaignSettings;
  status: CampaignStatus;
  createdAt: string;
  /** Data/hora programada (ISO) quando a campanha foi agendada */
  scheduledFor?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Observação, ex.: motivo de cancelamento automático */
  note?: string;
  /** Resumo de origem dos destinatários (para exibição no histórico) */
  sources: { type: MemberType; id: string; name: string }[];
}

export interface UazapiSettings {
  url: string;
  token: string;
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
