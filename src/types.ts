export type UserRole = 'Developer' | 'Operations' | 'Administrator' | 'Tester';

export type SeverityLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export type RiskLevel = 'Normal' | 'Warning' | 'High Risk' | 'Critical';

export type IncidentStatus = 'Open' | 'Investigating' | 'Mitigated' | 'Resolved';

export type CauseStatus = 'Probable' | 'Confirmed';

export type VerificationVerdict = 'Pending' | 'Improved' | 'Stayed Similar' | 'Became Worse';

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  title: string;
}

export interface AppThresholds {
  warningScore: number;
  highRiskScore: number;
  criticalScore: number;
  alertTriggerScore: number;
  maxErrorRatePct: number;
  maxLatencyMs: number;
  maxCpuPct: number;
  maxMemoryPct: number;
  pollingIntervalSec: number;
  verificationWindowSec: number;
}

export interface MonitoredApp {
  id: string;
  name: string;
  environment: 'production' | 'staging' | 'development';
  owner: string;
  description: string;
  components: string[];
  thresholds: AppThresholds;
  notificationTarget: string;
  createdAt: string;
  updatedAt: string;
}

export interface LogEntry {
  id: string;
  appId: string;
  timestamp: string;
  severity: SeverityLevel;
  message: string;
  source: string;
  component: string;
  stackTrace?: string;
  httpStatus?: number;
  latencyMs?: number;
  secretsMasked: number;
  ingestedAt: string;
}

export interface InvalidLogEntry {
  appId?: string;
  lineNumber: number;
  rawSnippet: string;
  reason: string;
  timestamp: string;
}

export interface RuntimeMetricPoint {
  id: string;
  appId: string;
  timestamp: string;
  cpuPct: number;
  memoryPct: number;
  latencyP95Ms: number;
  errorRatePct: number;
  dbPoolPct: number;
  requestsPerMin: number;
}

export interface ErrorCluster {
  id: string;
  appId: string;
  signature: string;
  sampleMessage: string;
  component: string;
  severity: SeverityLevel;
  count: number;
  recentCount: number;
  firstSeen: string;
  lastSeen: string;
  sampleStackTrace?: string;
  failureCategory: string;
  probableCause: string;
  confirmedCause?: string;
  causeStatus: CauseStatus;
  confirmedBy?: string;
  confirmedAt?: string;
  evidence: string[];
  recommendations: string[];
}

export interface RiskFactor {
  indicator: string;
  currentValue: string;
  baselineValue: string;
  contributionPoints: number;
  status: RiskLevel;
  explanation: string;
}

export interface FailurePrediction {
  appId: string;
  calculatedAt: string;
  riskScore: number;
  riskLevel: RiskLevel;
  anomalyDetected: boolean;
  anomalyZScore: number;
  probableFailureType: string;
  affectedComponents: string[];
  contributingFactors: RiskFactor[];
  disclaimer: string;
}

export interface AlertRecord {
  id: string;
  appId: string;
  appName: string;
  timestamp: string;
  riskScore: number;
  riskLevel: RiskLevel;
  majorIndicators: string[];
  probableFailureType: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  incidentId?: string;
}

export interface MetricSnapshot {
  capturedAt: string;
  riskScore: number;
  riskLevel: RiskLevel;
  errorRatePct: number;
  latencyP95Ms: number;
  cpuPct: number;
  memoryPct: number;
  dbPoolPct: number;
  errorCountWindow: number;
}

export interface FixVerificationRecord {
  id: string;
  incidentId: string;
  appId: string;
  appliedBy: string;
  appliedAt: string;
  fixSummary: string;
  selectedRecommendation?: string;
  verificationWindowSec: number;
  preFixSnapshot: MetricSnapshot;
  postFixSnapshot?: MetricSnapshot;
  verdict: VerificationVerdict;
  verdictNotes: string;
  deltas?: {
    riskScoreDelta: number;
    errorRateDelta: number;
    latencyDelta: number;
    memoryDelta: number;
    cpuDelta: number;
  };
}

export interface IncidentRecord {
  id: string;
  appId: string;
  appName: string;
  title: string;
  component: string;
  severity: SeverityLevel;
  riskScore: number;
  riskLevel: RiskLevel;
  status: IncidentStatus;
  clusterId?: string;
  failureCategory: string;
  probableCause: string;
  confirmedCause?: string;
  causeStatus: CauseStatus;
  evidence: string[];
  recommendations: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  latestFixId?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
}

export interface OverviewResponse {
  apps: MonitoredApp[];
  activeApp: MonitoredApp | null;
  prediction: FailurePrediction | null;
  allPredictions: Record<string, FailurePrediction>;
  metrics: RuntimeMetricPoint[];
  clusters: ErrorCluster[];
  alerts: AlertRecord[];
  allAlerts: AlertRecord[];
  allAlertsCount: number;
  incidents: IncidentRecord[];
  allIncidents: IncidentRecord[];
  fixes: FixVerificationRecord[];
  allFixes: FixVerificationRecord[];
  totalLogCount: number;
  invalidLogCount: number;
}

export interface IngestionResponse {
  appId: string;
  scenarioName?: string;
  description?: string;
  totalLines: number;
  validCount: number;
  invalidCount: number;
  invalidSample: InvalidLogEntry[];
  secretsMaskedCount: number;
  processingMs: number;
  prediction: FailurePrediction;
}

export interface PlainLanguageExplanation {
  available: boolean;
  model: string;
  sanitizedPromptPreview: string;
  plainSummary: string;
  whyItHappens: string;
  safeNextSteps: string[];
  errorMessage?: string;
}
