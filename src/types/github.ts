export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export type DevicePollResult = {
  status: "success" | "pending" | "slow_down" | "expired" | "denied" | "error" | "unknown";
  error: string | null;
};

export type GithubAuthStatus = {
  has_token: boolean;
  source: string;
};
