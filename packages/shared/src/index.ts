import { z } from "zod";

/* ---------------------------------- users ---------------------------------- */

export const zUsername = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9_]+$/, "letters, numbers and underscore only");

export const zPassword = z
  .string()
  .min(10, "at least 10 characters")
  .max(200)
  .regex(/[a-zA-Z]/, "needs a letter")
  .regex(/[0-9]/, "needs a digit");

export const zEmail = z.string().email().max(200).toLowerCase();

export const zDisplayName = z.string().trim().min(1).max(40);

export const zBio = z.string().trim().max(280).optional().or(z.literal(""));

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
}

export interface SelfProfile extends PublicProfile {
  email: string;
  createdAt: string;
  isPlatformAdmin: boolean;
  privacy: PrivacySettings;
}

export interface PrivacySettings {
  profileVisibility: "everyone" | "friends" | "private";
  friendRequests: "everyone" | "friends_of_friends" | "nobody";
  roomInvites: "everyone" | "friends" | "nobody";
  showOnlineStatus: boolean;
}

/* ---------------------------------- rooms ---------------------------------- */

export const GAME_IDS = [
  "truth_false",
  "truth_or_dare",
  "draw_together",
  "coop_puzzle",
  "this_or_that",
  "know_me",
  "word_association",
  "story_together",
  "would_you_rather",
  "guess_the_player",
] as const;

export type GameId = (typeof GAME_IDS)[number];

export const MAX_PLAYERS = 10;

export type RoomStatus = "lobby" | "playing" | "closed";
export type MemberRole = "host" | "player";

export interface RoomMemberView {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  role: MemberRole;
  ready: boolean;
  online: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  name: string;
  status: RoomStatus;
  hostId: string;
  gameId: GameId | null;
  members: RoomMemberView[];
  settings: RoomSettings;
  inviteUrl: string;
  createdAt: string;
}

export interface RoomSettings {
  truthOrDare: { maxTier: 1 | 2 | 3; allowMedia: boolean };
  drawTogether: { mode: "creative" | "template"; templateId: string | null; roundSeconds: number };
  truthFalse: { rounds: number; secondsPerRound: number };
}

export const defaultRoomSettings: RoomSettings = {
  truthOrDare: { maxTier: 3, allowMedia: true },
  drawTogether: { mode: "creative", templateId: null, roundSeconds: 300 },
  truthFalse: { rounds: 10, secondsPerRound: 30 },
};

/* ---------------------------------- chat ----------------------------------- */

export interface ChatMessageView {
  id: string;
  roomSessionId: string; // "room" for room chat, or session id for game chat
  senderId: string | null; // null = system
  senderName: string | null;
  kind: "text" | "system" | "media";
  body: string;
  mediaUrl: string | null;
  createdAt: string;
  reactions: Record<string, string[]>; // emoji -> userIds
}

/* --------------------------------- friends --------------------------------- */

export type FriendRequestDirection = "incoming" | "outgoing";

export interface FriendView {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  online: boolean;
}

export interface FriendRequestView {
  id: string;
  direction: FriendRequestDirection;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface NotificationView {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

/* --------------------------------- content --------------------------------- */

export type ContentKind = "truth" | "dare" | "statement" | "prompt" | "word" | "choice_pair";

export interface ContentItemMeta {
  id: string;
  kind: ContentKind;
  category: string;
  difficulty: 1 | 2 | 3;
  language: string;
  body: string | null;
  options: string[] | null; // for choice_pair / truth_false statements option isn't used
  mediaPolicy: "none" | "optional" | "required"; // for dares
  mediaKinds: string[]; // photo | video | voice | drawing
}

/* --------------------------------- games ----------------------------------- */

/** Base for all game state snapshots. Stored as JSON in game_sessions.state. */
export interface BaseGameState {
  status: "active" | "completed";
  round: number;
}

/** A player action sent over the socket: `game:action { action, payload }`. */
export interface GameAction {
  action: string;
  payload: unknown;
}

/**
 * The contract every game implements on the server. `S` is the game's state shape.
 * The engine guarantees: caller is an authenticated member; payload already
 * zod-validated by the game's `actionSchema`; state mutations happen inside the
 * engine's transaction.
 */
export interface GameModule<S extends BaseGameState = BaseGameState> {
  id: GameId;
  name: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  approxMinutes: number;
  style: string; // "conversation" | "creative" | "cooperative" | "quiz"
  actionSchema: z.ZodTypeAny;

  createState(ctx: { playerIds: string[]; settings: RoomSettings }): S;
  onAction(
    state: S,
    ctx: {
      userId: string;
      payload: unknown;
      playerIds: string[];
      settings: RoomSettings;
      now: number;
    },
  ): GameEffect<S>;
  /** Optional periodic tick (timers). Return effects or null. */
  tick?(state: S, ctx: { playerIds: string[]; settings: RoomSettings; now: number }): GameEffect<S> | null;
  onPlayerLeft?(state: S, userId: string, ctx: { playerIds: string[] }): GameEffect<S> | null;
  scoreSummary(state: S): Array<{ userId: string; displayName: string; score: number }>;
  /** Per-player projection; hidden information must not leak into another player's view. */
  view(state: S, userId: string | null, extras: GameViewExtras): Record<string, unknown>;
}

/** Extra data modules may attach to their public view (e.g. member display names). */
export interface GameViewExtras {
  members: Array<{ userId: string; displayName: string; username: string; avatarUrl: string | null }>;
  hostId: string;
}

/**
 * Effects a game action can produce. The engine interprets them:
 * - state: new authoritative state
 * - systemMessages: appended to the session's game chat
 * - broadcastEvents: forwarded verbatim to the room (e.g. incremental draw strokes)
 * - completed: session finished
 */
export interface GameEffect<S> {
  state: S;
  systemMessages?: string[];
  broadcastEvents?: Array<{ event: string; payload: unknown }>;
  completed?: boolean;
}
