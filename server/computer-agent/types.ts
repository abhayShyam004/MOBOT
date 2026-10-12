// Types and contracts for General-Purpose Computer Agent (master_prompt_02.md)

export type ProcessLifecycleState =
  | "CREATED"
  | "STARTING"
  | "RUNNING"
  | "HEALTHY"
  | "UNHEALTHY"
  | "CRASHED"
  | "STOPPING"
  | "STOPPED";

export interface ManagedProcessRecord {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  pid?: number;
  state: ProcessLifecycleState;
  startTime: string;
  endTime?: string;
  exitCode?: number | null;
  signal?: string | null;
  ports: number[];
  tag?: string;
  healthEndpoint?: string;
  logFile: string;
  lastError?: string;
}

export interface ProcessStartOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  ports?: number[];
  tag?: string;
  healthEndpoint?: string;
}

export interface RuntimeInfo {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  details?: string;
}

export interface EnvironmentReport {
  operatingSystem: {
    platform: string;
    arch: string;
    release: string;
    isAndroid: boolean;
    androidVersion?: string;
    deviceModel?: string;
  };
  resources: {
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    workspacePath: string;
    workspaceFreeBytes?: number;
    workspaceTotalBytes?: number;
  };
  runtimes: Record<string, RuntimeInfo>;
  network: {
    online: boolean;
    latencyMs?: number;
    details?: string;
  };
  browserDriver: {
    available: boolean;
    driverPort?: number;
  };
  terminalCapabilities: {
    hasPty: boolean;
    hasNativeLauncher: boolean;
    shellPath: string;
  };
}

export interface ServiceVerificationOptions {
  portOrUrl: number | string;
  expectedStatus?: number[];
  timeoutMs?: number;
  expectedContentPattern?: string;
  processId?: string;
  minConsecutiveChecks?: number;
  startupTimeoutMs?: number;
}

export interface ServiceVerificationResult {
  verified: boolean;
  target: string;
  port?: number;
  httpStatus?: number;
  latencyMs?: number;
  processState?: ProcessLifecycleState;
  processPid?: number;
  bodyPreview?: string;
  consecutiveSuccesses: number;
  error?: string;
  diagnosis?: string;
}

export interface FileVerificationOptions {
  path: string;
  validateSyntax?: "json" | "js" | "yaml" | "none";
  expectedMinBytes?: number;
}

export interface FileVerificationResult {
  verified: boolean;
  path: string;
  exists: boolean;
  sizeBytes: number;
  lineCount: number;
  sha256?: string;
  syntaxValid?: boolean;
  error?: string;
}
