// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  DRIVER = 'DRIVER',
}

export enum StudentStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum PaymentMethod {
  UPI = 'UPI',
  CASH = 'CASH',
  BANK = 'BANK',
  OTHER = 'OTHER',
}

export enum PaymentStatus {
  PAID = 'PAID',
  PENDING = 'PENDING',
  OVERDUE = 'OVERDUE',
}

export enum WhatsAppMessageType {
  REMINDER_1 = 'REMINDER_1',
  REMINDER_2 = 'REMINDER_2',
  REMINDER_3 = 'REMINDER_3',
  FINAL = 'FINAL',
  CONFIRMATION = 'CONFIRMATION',
  EMERGENCY = 'EMERGENCY',
}

export enum WhatsAppMessageStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE ENTITIES
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string; // ISO string
}

export interface Student {
  id: string;
  name: string;
  school: string;
  class: string;
  routeId: string | null;
  parentName: string;
  fatherMobile: string;
  motherMobile: string;
  whatsappNumber: string;
  /** Monthly fee in paise (e.g. 250000 = ₹2500) */
  monthlyFee: number;
  joiningDate: string;
  status: StudentStatus;
  pickupAddress: string;
  dropAddress: string;
  pickupTime: string;
  dropTime: string;
  vehicleNumber: string;
  createdAt: string;
  route?: Route;
}

export interface Route {
  id: string;
  name: string;
  driverId: string | null;
  vehicleNumber: string;
  isActive: boolean;
  createdAt: string;
  driver?: User;
  _count?: { students: number };
}

export interface Payment {
  id: string;
  studentId: string;
  /** Amount in paise */
  amount: number;
  month: number;
  year: number;
  paidAt: string;
  transactionId: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  receiptUrl: string | null;
  remarks: string | null;
  createdAt: string;
  student?: Pick<Student, 'id' | 'name' | 'school' | 'parentName'>;
}

export interface FeeSchedule {
  id: string;
  studentId: string;
  month: number;
  year: number;
  dueDate: string;
  /** Amount in paise */
  amount: number;
  isPaid: boolean;
  overdueAt: string | null;
  student?: Pick<Student, 'id' | 'name' | 'school' | 'parentName' | 'whatsappNumber'>;
}

export interface WhatsAppMessage {
  id: string;
  studentId: string | null;
  phone: string;
  type: WhatsAppMessageType;
  body: string;
  scheduledAt: string | null;
  sentAt: string | null;
  status: WhatsAppMessageStatus;
  createdAt: string;
  student?: Pick<Student, 'id' | 'name'>;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  meta: Record<string, unknown>;
  createdAt: string;
  user?: Pick<User, 'id' | 'name' | 'email'>;
}

export interface DailyReport {
  id: string;
  date: string;
  /** Total collected in paise */
  totalCollected: number;
  paymentCount: number;
  createdAt: string;
}

export interface Settings {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// API RESPONSE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedParams {
  page?: number;
  limit?: number;
  search?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST BODY TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken?: string;
}

export interface CreateStudentRequest {
  name: string;
  school: string;
  class: string;
  routeId?: string;
  parentName: string;
  fatherMobile: string;
  motherMobile: string;
  whatsappNumber: string;
  /** Monthly fee in paise */
  monthlyFee: number;
  joiningDate: string;
  pickupAddress: string;
  dropAddress: string;
  pickupTime: string;
  dropTime: string;
  vehicleNumber: string;
}

export type UpdateStudentRequest = Partial<CreateStudentRequest>;

export interface CreateRouteRequest {
  name: string;
  driverId?: string;
  vehicleNumber: string;
}

export interface CreatePaymentRequest {
  studentId: string;
  /** Amount in paise */
  amount: number;
  month: number;
  year: number;
  method: PaymentMethod;
  transactionId?: string;
  remarks?: string;
}

export interface SendWhatsAppRequest {
  phone: string;
  message: string;
}

export interface BroadcastWhatsAppRequest {
  phones: string[];
  template: WhatsAppMessageType;
  variables: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyReportData {
  totalCollected: number;
  totalPending: number;
  totalStudents: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  collectionRate: number;
}

export interface SchoolWiseReport {
  school: string;
  total: number;
  collected: number;
  pending: number;
}

export interface RouteWiseReport {
  routeId: string;
  routeName: string;
  total: number;
  collected: number;
  pending: number;
}

export interface PendingStudent {
  studentId: string;
  studentName: string;
  parentName: string;
  whatsappNumber: string;
  school: string;
  /** Amount in paise */
  amount: number;
  daysOverdue: number;
  month: number;
  year: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP TEMPLATE VARIABLES
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppTemplateVars {
  parentName: string;
  amount: string;
  month: string;
  upiId: string;
  businessName: string;
  receiptId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV IMPORT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PhonePeCSVRow {
  date: string;
  debit: string;
  credit: string;
  balance: string;
  description: string;
  referenceNo: string;
}

export interface CSVImportResult {
  total: number;
  matched: number;
  unmatched: number;
  errors: number;
  unmatchedRows: PhonePeCSVRow[];
}
