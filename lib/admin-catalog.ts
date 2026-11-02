import { ReviewStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { readBookBibliographicMetadata, writeBookBibliographicMetadata } from "./book-bibliographic-metadata";
import { notifyUsers, publicationReviewers } from "./notifications";
import { countCloudPendingCatalogReviews, deleteCloudAdminCatalogDraft, listCloudAdminCatalog, listCloudAdminCatalogDrafts, reviewCloudAdminCatalog, saveCloudAdminCatalog, withdrawCloudAdminCatalogSubmission } from "./cloud-admin-catalog";
import { usesCloudRuntime } from "./cloud-runtime";
import { deleteStoredMedia } from "./media-storage";
import { ensureCatalogReviewBaseline } from "./catalog-review-baseline";

export type AdminCatalogType = "manuscript" | "artifact";
export type AdminCatalogInput = { id?: string; type: AdminCatalogType; title: string; language?: string; author?: string; dynasty?: string; eraDetail?: string; publicationDate?: string; imprintPublisher?: string; versionType?: string; binding?: string; volumeCount?: number; categories?: string[]; category?: string; era?: string; material?: string; description?: string; source?: string; keywords?: string[]; status?: ReviewStatus };
type WorkflowActor = { userId: string };
const statuses = new Set<ReviewStatus>(["DRAFT", "PENDING", "APPROVED", "REJECTED", "NEEDS_REVISION", "ARCHIVED"]);
const catalogNumberFor = (type: AdminCatalogType, id: string) => `HH-${type === "manuscript" ? "M" : "A"}-${id.slice(-6).toUpperCase()}`;
const string = (value: unknown, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";
const optional = (value: unknown, max = 300) => string(value, max) || undefined;
const list = (value: unknown, maxItems = 12) => Array.isArray(value) ? value.map((item) => string(item, 120)).filter(Boolean).slice(0, maxItems) : typeof value === "string" ? value.split(/[、,，;；\n]/).map((item) => string(item, 120)).filter(Boolean).slice(0, maxItems) : [];

export function parseAdminCatalogInput(value: unknown): AdminCatalogInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const type = body.type === "manuscript" || body.type === "artifact" ? body.type : null;
  const title = string(body.title, 200);
  if (!type || !title) return null;
  const keywords = Array.isArray(body.keywords) ? body.keywords.map((item) => string(item, 80)).filter(Boolean).slice(0, 20) : [];
  const volumeCount = Math.max(1, Math.min(999, Math.floor(Number(body.volumeCount) || 1)));
  const requestedStatus = typeof body.status === "string" && statuses.has(body.status as ReviewStatus) ? body.status as ReviewStatus : "DRAFT";
  return { id: optional(body.id, 100), type, title, language: optional(body.language), author: optional(body.author), dynasty: optional(body.dynasty), eraDetail: optional(body.eraDetail), publicationDate: optional(body.publicationDate), imprintPublisher: optional(body.imprintPublisher), versionType: optional(body.versionType), binding: optional(body.binding), volumeCount, categories: list(body.categories), category: optional(body.category), era: optional(body.era), material: optional(body.material), description: optional(body.description, 3000), source: optional(body.source), keywords, status: requestedStatus };
}

export async function listAdminCatalog(type?: AdminCatalogType, onlyWithMedia = false) {
  const cloud = await listCloudAdminCatalog(type, onlyWithMedia);
  if (cloud) return cloud;
  // The edit picker is deliberately limited to records that are already part of
  // the approved catalogue.  A draft or pending record may have an attachment,
  // but must not be presented as an established item that can be edited here.
  const mediaWhere = onlyWithMedia ? { status: "APPROVED" as ReviewStatus, media: { some: {} } } : undefined;
  const [books, artifacts] = await Promise.all([
    !type || type === "manuscript" ? prisma.book.findMany({ where: mediaWhere, orderBy: { updatedAt: "desc" }, select: { id: true, catalogNumber: true, title: true, language: true, author: true, dynasty: true, versionType: true, description: true, source: true, keywords: true, status: true, submittedByLane: true, reviewerLane: true, reviewComment: true } }) : [],
    !type || type === "artifact" ? prisma.artifact.findMany({ where: mediaWhere, orderBy: { updatedAt: "desc" }, select: { id: true, catalogNumber: true, title: true, category: true, era: true, material: true, description: true, source: true, keywords: true, status: true, submittedByLane: true, reviewerLane: true, reviewComment: true } }) : [],
  ]);
  const metadata = await readBookBibliographicMetadata(books.map((book) => book.id));
  return [...books.map((book) => ({ ...book, ...metadata.get(book.id), type: "manuscript" as const, category: null, era: null, material: null })), ...artifacts.map((artifact) => ({ ...artifact, type: "artifact" as const, language: null, author: null, dynasty: null, eraDetail: null, publicationDate: null, imprintPublisher: null, versionType: null, binding: null, volumeCount: null, categories: [] }))];
}

export async function listMyAdminCatalogDrafts(userId: string) {
  const cloud = await listCloudAdminCatalogDrafts(userId);
  if (cloud) return cloud;
  const where = { submittedByUserId: userId, status: { in: ["DRAFT", "REJECTED", "NEEDS_REVISION", "PENDING"] as ReviewStatus[] } };
  const [books, artifacts] = await Promise.all([
    prisma.book.findMany({ where, orderBy: { updatedAt: "desc" }, select: { id: true, catalogNumber: true, title: true, language: true, author: true, dynasty: true, versionType: true, description: true, source: true, keywords: true, status: true, reviewComment: true, updatedAt: true, _count: { select: { media: true } } } }),
    prisma.artifact.findMany({ where, orderBy: { updatedAt: "desc" }, select: { id: true, catalogNumber: true, title: true, category: true, era: true, material: true, description: true, source: true, keywords: true, status: true, reviewComment: true, updatedAt: true, _count: { select: { media: true } } } }),
  ]);
  const metadata = await readBookBibliographicMetadata(books.map((book) => book.id));
  return [...books.map(({ _count, ...book }) => ({ ...book, ...metadata.get(book.id), type: "manuscript" as const, category: null, era: null, material: null, mediaCount: _count.media })), ...artifacts.map(({ _count, ...artifact }) => ({ ...artifact, type: "artifact" as const, language: null, author: null, dynasty: null, eraDetail: null, publicationDate: null, imprintPublisher: null, versionType: null, binding: null, volumeCount: null, categories: [], mediaCount: _count.media }))];
}

export async function withdrawAdminCatalogSubmission(input: { id: string; type: AdminCatalogType }, actor: WorkflowActor) {
  const cloud = await withdrawCloudAdminCatalogSubmission(input, actor);
  if (cloud) return cloud;
  const where = { id: input.id, status: "PENDING" as ReviewStatus, submittedByUserId: actor.userId };
  const result = input.type === "manuscript" ? await prisma.book.updateMany({ where, data: { status: "DRAFT" } }) : await prisma.artifact.updateMany({ where, data: { status: "DRAFT" } });
  if (!result.count) throw new Error("仅可撤回本人正在审核中的资料。");
  await prisma.auditEvent.create({ data: { entityType: input.type === "manuscript" ? "BOOK" : "ARTIFACT", entityId: input.id, action: "CATALOG_SUBMISSION_WITHDRAWN", actorId: actor.userId } });
  return { id: input.id, type: input.type, status: "DRAFT" as const };
}

export async function deleteAdminCatalogDraft(input: { id: string; type: AdminCatalogType }, actor: WorkflowActor) {
  const cloud = await deleteCloudAdminCatalogDraft(input, actor);
  if (cloud) return cloud;
  const record = input.type === "manuscript"
    ? await prisma.book.findFirst({ where: { id: input.id, status: { in: ["DRAFT", "REJECTED", "NEEDS_REVISION"] }, submittedByUserId: actor.userId }, include: { media: { select: { storageKey: true } } } })
    : await prisma.artifact.findFirst({ where: { id: input.id, status: { in: ["DRAFT", "REJECTED", "NEEDS_REVISION"] }, submittedByUserId: actor.userId }, include: { media: { select: { storageKey: true } } } });
  if (!record) throw new Error("仅可删除本人草稿或待修改资料。");
  if (input.type === "manuscript") await prisma.book.delete({ where: { id: record.id } });
  else await prisma.artifact.delete({ where: { id: record.id } });
  await Promise.all(record.media.map((asset) => deleteStoredMedia(asset.storageKey)));
  await prisma.auditEvent.create({ data: { entityType: input.type === "manuscript" ? "BOOK" : "ARTIFACT", entityId: input.id, action: "CATALOG_DRAFT_DELETED", actorId: actor.userId } });
  return { deleted: true };
}

export async function saveAdminCatalog(input: AdminCatalogInput, submitter?: WorkflowActor) {
  const cloud = await saveCloudAdminCatalog(input, submitter);
  if (cloud) return cloud;
  const isSubmission = input.status === "PENDING";
  const previousStatus = input.id
    ? input.type === "manuscript"
      ? (await prisma.book.findUnique({ where: { id: input.id }, select: { status: true } }))?.status
      : (await prisma.artifact.findUnique({ where: { id: input.id }, select: { status: true } }))?.status
    : undefined;
  const workflow = isSubmission && submitter ? { submittedByUserId: submitter.userId, submittedByLane: null, reviewedByUserId: null, reviewerLane: null, reviewComment: null, reviewedAt: null } : !input.id && submitter ? { submittedByUserId: submitter.userId, submittedByLane: null } : {};
  if (input.id && previousStatus === "APPROVED") await ensureCatalogReviewBaseline(input.type, input.id);
  // This is the sole write path for the digitisation catalogue. Holding
  // imports never set this marker, even if an imported record has images.
  const common = { title: input.title, description: input.description, source: input.source, keywords: input.keywords ?? [], status: input.status ?? "DRAFT", isDigitalHeritage: true, ...workflow };
  if (input.type === "manuscript") {
    const data = { ...common, language: input.language, author: input.author, dynasty: input.dynasty, versionType: input.versionType };
    const book = input.id ? await prisma.book.update({ where: { id: input.id }, data }) : await prisma.book.create({ data });
    const catalogNumber = book.catalogNumber ?? catalogNumberFor("manuscript", book.id);
    if (!book.catalogNumber) await prisma.book.update({ where: { id: book.id }, data: { catalogNumber } });
    await writeBookBibliographicMetadata(book.id, { eraDetail: input.eraDetail ?? null, publicationDate: input.publicationDate ?? null, imprintPublisher: input.imprintPublisher ?? null, binding: input.binding ?? null, volumeCount: input.volumeCount ?? 1, categories: input.categories ?? [] });
    await prisma.auditEvent.create({ data: { entityType: "BOOK", entityId: book.id, action: input.id ? "ADMIN_UPDATED" : "ADMIN_CREATED", actorId: submitter?.userId, payload: { status: book.status } } });
    return { id: book.id, catalogNumber, type: "manuscript" as const, title: book.title, submittedForReview: isSubmission && previousStatus !== "PENDING" };
  }
  const data = { ...common, category: input.category || "待分类", era: input.era, material: input.material };
  const artifact = input.id ? await prisma.artifact.update({ where: { id: input.id }, data }) : await prisma.artifact.create({ data });
  const catalogNumber = artifact.catalogNumber ?? catalogNumberFor("artifact", artifact.id);
  if (!artifact.catalogNumber) await prisma.artifact.update({ where: { id: artifact.id }, data: { catalogNumber } });
  await prisma.auditEvent.create({ data: { entityType: "ARTIFACT", entityId: artifact.id, action: input.id ? "ADMIN_UPDATED" : "ADMIN_CREATED", actorId: submitter?.userId, payload: { status: artifact.status } } });
  return { id: artifact.id, catalogNumber, type: "artifact" as const, title: artifact.title, submittedForReview: isSubmission && previousStatus !== "PENDING" };
}

export async function notifyCatalogSubmission(record: { type: AdminCatalogType; title: string }, submitterId: string) {
  if (usesCloudRuntime()) return { count: 0 };
  const reviewers = (await publicationReviewers()).filter((id) => id !== submitterId);
  return notifyUsers(reviewers, {
    kind: "CATALOG_REVIEW",
    title: "有新的古籍文物待审核",
    message: `“${record.title}”已提交${record.type === "manuscript" ? "古籍" : "文物"}审核。`,
    href: "/admin/catalog-review",
  });
}

export async function countPendingCatalogReviewsForReviewer(userId: string) {
  const cloud = await countCloudPendingCatalogReviews(userId);
  if (cloud !== null) return cloud;
  const pending = { status: "PENDING" as ReviewStatus, submittedByUserId: { not: userId } };
  // A running local development server can retain an older generated Prisma
  // client while source files are hot-reloaded. Keep the review entry usable
  // during that short transition; after restart this also counts deletions.
  const deletionRequests = (prisma as unknown as { catalogDeletionRequest?: { count: (args: { where: { status: "PENDING"; submittedByUserId: { not: string } } }) => Promise<number> } }).catalogDeletionRequest;
  const [books, artifacts, deletions] = await Promise.all([
    prisma.book.count({ where: pending }),
    prisma.artifact.count({ where: pending }),
    deletionRequests?.count({ where: { status: "PENDING", submittedByUserId: { not: userId } } }) ?? Promise.resolve(0),
  ]);
  return books + artifacts + deletions;
}

export async function reviewAdminCatalog(input: { id: string; type: AdminCatalogType; decision: "APPROVED" | "REJECTED" | "NEEDS_REVISION"; comment?: string }, reviewer: WorkflowActor) {
  const cloud = await reviewCloudAdminCatalog(input, reviewer);
  if (cloud) return cloud;
  const comment = optional(input.comment, 1000) ?? null;
  if (input.type === "manuscript") {
    const book = await prisma.book.findUnique({ where: { id: input.id }, select: { id: true, status: true, submittedByUserId: true, submittedByLane: true } });
    if (!book) throw new Error("未找到该古籍资料。");
    if (book.status !== "PENDING") throw new Error("只有待审核资料可以进入审核流程。");
    if (book.submittedByUserId === reviewer.userId) throw new Error("同一账号不能审核自己提交的资料，请由其他拥有审核权限的用户处理。");
    await prisma.book.update({ where: { id: book.id }, data: { status: input.decision, reviewedByUserId: reviewer.userId, reviewerLane: null, reviewComment: comment, reviewedAt: new Date() } });
    await prisma.auditEvent.create({ data: { entityType: "BOOK", entityId: book.id, action: `CATALOG_${input.decision}`, actorId: reviewer.userId, payload: { comment } } });
    if (book.submittedByUserId) await notifyUsers([book.submittedByUserId], { kind: "CATALOG_REVIEW_RESULT", title: "古籍审核结果", message: `您提交的古籍审核结果为：${input.decision === "APPROVED" ? "已通过并公开" : input.decision === "NEEDS_REVISION" ? "需要补充" : "已退回"}${comment ? `。审核说明：${comment}` : "。"}`, href: "/admin/catalog" });
    return { id: book.id, type: input.type, status: input.decision };
  }
  const artifact = await prisma.artifact.findUnique({ where: { id: input.id }, select: { id: true, status: true, submittedByUserId: true, submittedByLane: true } });
  if (!artifact) throw new Error("未找到该文物资料。");
  if (artifact.status !== "PENDING") throw new Error("只有待审核资料可以进入审核流程。");
  if (artifact.submittedByUserId === reviewer.userId) throw new Error("同一账号不能审核自己提交的资料，请由其他拥有审核权限的用户处理。");
  await prisma.artifact.update({ where: { id: artifact.id }, data: { status: input.decision, reviewedByUserId: reviewer.userId, reviewerLane: null, reviewComment: comment, reviewedAt: new Date() } });
  await prisma.auditEvent.create({ data: { entityType: "ARTIFACT", entityId: artifact.id, action: `CATALOG_${input.decision}`, actorId: reviewer.userId, payload: { comment } } });
  if (artifact.submittedByUserId) await notifyUsers([artifact.submittedByUserId], { kind: "CATALOG_REVIEW_RESULT", title: "文物审核结果", message: `您提交的文物审核结果为：${input.decision === "APPROVED" ? "已通过并公开" : input.decision === "NEEDS_REVISION" ? "需要补充" : "已退回"}${comment ? `。审核说明：${comment}` : "。"}`, href: "/admin/catalog" });
  return { id: artifact.id, type: input.type, status: input.decision };
}
