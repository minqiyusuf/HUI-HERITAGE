import type { CatalogRecord, CatalogType } from "./catalog";
import { readBookBibliographicMetadata } from "./book-bibliographic-metadata";
import { readCloudCatalogRecords } from "./cloud-catalog-reader";
import { prisma } from "./prisma";

export type CatalogQuery = {
  query?: string;
  type?: string;
  title?: string;
  category?: string;
  language?: string;
  author?: string;
  time?: string;
  imprint?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
};

/**
 * The single read boundary for catalogue pages. All public pages and APIs read
 * their data through Prisma so the database remains the source of truth.
 */
type DatabaseRecord = {
  id: string;
  catalogNumber: string | null;
  title: string;
  description: string | null;
  source: string | null;
  keywords: string[];
  date: string | null;
  type: CatalogType;
  metadata: Array<{ label: string; value: string | null | undefined }>;
  media: { id: string; storageKey: string; mimeType: string; visibility: "PUBLIC" | "MEMBER_ONLY" | "PRIVATE" }[];
};

const digitalBookWhere = {
  AND: [
    { status: "APPROVED" as const },
    { isDigitalHeritage: true },
  ],
};

function volumeNumberFromStorageKey(storageKey: string, fallback: number) {
  const match = storageKey.match(/-v(\d+)-/i);
  return match ? Number(match[1]) : fallback;
}

function toCatalogRecord(record: DatabaseRecord): CatalogRecord {
  const media = record.media.find((asset) => asset.visibility === "PUBLIC" && asset.mimeType.startsWith("image/"));
  const publicImages = record.media.filter((asset) => asset.visibility === "PUBLIC" && asset.mimeType.startsWith("image/")).map((asset) => asset.storageKey.startsWith("private/") ? `/api/catalog/${record.id}/media/${asset.id}` : `/${asset.storageKey}`);
  const memberDocuments = record.media.filter((asset) => asset.visibility === "MEMBER_ONLY" && asset.mimeType === "application/pdf").map((asset, index) => {
    const volumeNumber = volumeNumberFromStorageKey(asset.storageKey, index + 1);
    return { id: asset.id, href: `/api/catalog/${record.id}/member-media/${asset.id}`, volumeNumber, label: `第${volumeNumber}册` };
  }).sort((left, right) => left.volumeNumber - right.volumeNumber);
  const imageAccess = publicImages.length > 0 ? "public" : "none";
  const image = publicImages[0] ?? `/private-media/${media?.storageKey.replace(/^private\//, "") ?? "unavailable"}`;
  return {
    id: record.id,
    catalogNumber: record.catalogNumber ?? undefined,
    title: record.title,
    type: record.type,
    summary: record.description ?? "暂无资料说明。",
    date: record.date ?? "待考",
    source: record.source ?? "来源待补充",
    image,
    imageAccess,
    images: publicImages,
    memberDocuments,
    metadata: record.metadata.filter((item) => Boolean(item.value)).map((item) => ({ label: item.label, value: item.value!.trim() })),
    keywords: record.keywords,
  };
}

function matchesQuery(record: CatalogRecord, query: string) {
  const terms = query.replace(/[《》〈〉「」『』“”"'，、；：]/g, " ").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [record.catalogNumber, record.title, record.summary, record.date, record.source, ...record.keywords, ...(record.metadata ?? []).map((item) => item.value)].join(" ").toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function bookMetadata(book: { language: string | null; author: string | null; dynasty: string | null; eraDetail: string | null; publicationDate: string | null; imprintPublisher: string | null; versionType: string | null; binding: string | null; volumeCount: number; categories: string[] }) {
  return [
    { label: "分类", value: book.categories.join("；") },
    { label: "语言", value: book.language },
    { label: "作者", value: book.author },
    { label: "册数", value: String(book.volumeCount) },
    { label: "年代", value: book.dynasty },
    { label: "刊刻年份", value: book.eraDetail },
    { label: "刊刻时间", value: book.publicationDate },
    { label: "刊刻主体", value: book.imprintPublisher },
    { label: "版本类型", value: book.versionType },
    { label: "装帧", value: book.binding },
  ];
}

async function readApprovedCatalogRecords(): Promise<CatalogRecord[]> {
  const cloudRecords = await readCloudCatalogRecords();
  if (cloudRecords) return cloudRecords;
  const [books, artifacts] = await Promise.all([
    prisma.book.findMany({ where: digitalBookWhere, include: { media: { orderBy: { createdAt: "asc" } } } }),
    prisma.artifact.findMany({ where: { status: "APPROVED", isDigitalHeritage: true }, include: { media: { orderBy: { createdAt: "asc" } } } }),
  ]);
  const bookExtras = await readBookBibliographicMetadata(books.map((book) => book.id));
  const bookRecords = books.map((book) => { const metadata = bookExtras.get(book.id) ?? { eraDetail: null, publicationDate: null, imprintPublisher: null, binding: null, volumeCount: 1, categories: [] }; return toCatalogRecord({ ...book, ...metadata, date: metadata.publicationDate ?? metadata.eraDetail ?? book.dynasty, type: "manuscript", metadata: bookMetadata({ ...book, ...metadata }) }); });
  const artifactRecords = artifacts.map((artifact) => toCatalogRecord({ ...artifact, date: artifact.era, type: "artifact", metadata: [{ label: "类别", value: artifact.category }, { label: "年代", value: artifact.era }, { label: "材质", value: artifact.material }] }));
  return [...bookRecords, ...artifactRecords].sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
}

function metadataValue(record: CatalogRecord, label: string) { return record.metadata?.find((item) => item.label === label)?.value ?? ""; }
function includes(value: string, query: string | undefined) { return !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase()); }

export async function listCatalogRecords({ query = "", type, title, category, language, author, time, imprint, limit }: CatalogQuery = {}): Promise<CatalogRecord[]> {
  const records = (await readApprovedCatalogRecords()).filter((record) =>
    (!type || record.type === type) && matchesQuery(record, query) && includes(record.title, title) && includes(metadataValue(record, "分类"), category) && includes(metadataValue(record, "语言"), language) && includes(metadataValue(record, "作者"), author) && includes([record.date, metadataValue(record, "年代"), metadataValue(record, "刊刻年份"), metadataValue(record, "刊刻时间")].join(" "), time) && includes(metadataValue(record, "刊刻主体"), imprint),
  );
  return typeof limit === "number" ? records.slice(0, limit) : records;
}

export async function findCatalogRecords(query: CatalogQuery = {}) {
  const allRecords = await listCatalogRecords(query);
  const pageSize = Math.min(48, Math.max(1, Math.floor(query.pageSize ?? 12)));
  const total = allRecords.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(query.page ?? 1)));
  const start = (page - 1) * pageSize;
  return { records: allRecords.slice(start, start + pageSize), total, page, pageSize, totalPages };
}

export async function getCatalogRecord(id: string): Promise<CatalogRecord | null> {
  const cloudRecords = await readCloudCatalogRecords();
  if (cloudRecords) {
    const record = cloudRecords.find((item) => item.id === id || item.catalogNumber === id) ?? null;
    return record;
  }
  const book = await prisma.book.findFirst({ where: { AND: [digitalBookWhere, { OR: [{ id }, { catalogNumber: id }] }] }, include: { media: { orderBy: { createdAt: "asc" } } } });
  if (book) { const metadata = (await readBookBibliographicMetadata([book.id])).get(book.id) ?? { eraDetail: null, publicationDate: null, imprintPublisher: null, binding: null, volumeCount: 1, categories: [] }; return toCatalogRecord({ ...book, ...metadata, date: metadata.publicationDate ?? metadata.eraDetail ?? book.dynasty, type: "manuscript", metadata: bookMetadata({ ...book, ...metadata }) }); }
  const artifact = await prisma.artifact.findFirst({ where: { AND: [{ status: "APPROVED" }, { isDigitalHeritage: true }, { OR: [{ id }, { catalogNumber: id }] }] }, include: { media: { orderBy: { createdAt: "asc" } } } });
  if (!artifact) return null;
  return toCatalogRecord({ ...artifact, date: artifact.era, type: "artifact", metadata: [{ label: "类别", value: artifact.category }, { label: "年代", value: artifact.era }, { label: "材质", value: artifact.material }] });
}

export async function getCatalogOverview() {
  const records = await listCatalogRecords();
  const manuscripts = records.filter((record) => record.type === "manuscript").length;
  return { total: records.length, manuscripts, artifacts: records.length - manuscripts };
}

/** Live counts used by the homepage collection summary. */
export async function getHomepageCollectionStats() {
  const cloudRecords = await readCloudCatalogRecords();
  if (cloudRecords) {
    const db = await (await import("./cloud-runtime")).cloudD1();
    const holdings = await db!.prepare("SELECT COUNT(*) AS total FROM cloud_holdings WHERE status = ?").bind("APPROVED").all<{ total: number }>();
    return { digitalManuscripts: cloudRecords.filter((record) => record.type === "manuscript").length, holdingRecords: holdings.results?.[0]?.total ?? 0, personalCollections: 0 };
  }
  const [digitalManuscripts, holdingRecords, personalCollections] = await Promise.all([
    prisma.book.count({ where: digitalBookWhere }),
    prisma.holding.count({ where: { status: "APPROVED" } }),
    prisma.personalCollectionItem.groupBy({ by: ["ownerId"], where: { type: "BOOK" } }).then((owners) => owners.length),
  ]);
  return { digitalManuscripts, holdingRecords, personalCollections };
}

export function isCatalogType(value: string | undefined): value is CatalogType {
  return value === "manuscript" || value === "artifact";
}
