import { invoke } from "../../platform/ipc";
import type {
  BatchDeployResult,
  DeploymentPlan,
  DeploymentTarget,
  DeviceCodeResponse,
  DevicePollResult,
  GithubAuthStatus,
  QuarantineItem,
  SkillRepoGroup,
  SnapshotDiff,
  TranslationDoc,
} from "../../types";

export const skillsApi = {
  githubTokenStatus: () => invoke<GithubAuthStatus>("github_token_status"),
  quarantineList: () => invoke<QuarantineItem[]>("skill_quarantine_list"),
  getTranslation: (skillName: string, currentSnapshotId: string | null) =>
    invoke<TranslationDoc | null>("skill_get_translation", {
      skillName,
      currentSnapshotId,
    }),
  scanRepo: (repoPath: string | null, repoName: string | null) =>
    invoke<SkillRepoGroup>("skills_scan_repo", { repoPath, repoName }),
  scanGithub: (repo: string, gitRef: string | null, skillPath: string | null) =>
    invoke<SkillRepoGroup>("skills_scan_github", { repo, gitRef, skillPath }),
  quarantineDelete: (quarantineId: string) =>
    invoke<void>("skill_quarantine_delete", { quarantineId }),
  batchDeployPlan: (snapshotId: string, targets: DeploymentTarget[]) =>
    invoke<DeploymentPlan>("skill_batch_deploy_plan", { snapshotId, targets }),
  batchDeployApply: (snapshotId: string, targets: DeploymentTarget[]) =>
    invoke<BatchDeployResult>("skill_batch_deploy_apply", { snapshotId, targets }),
  getDiff: (baseSnapshotId: string, headSnapshotId: string) =>
    invoke<SnapshotDiff>("skill_get_diff", { baseSnapshotId, headSnapshotId }),
  saveTranslation: (doc: TranslationDoc) => invoke<void>("skill_save_translation", { doc }),
};

export const githubApi = {
  tokenStatus: () => invoke<GithubAuthStatus>("github_token_status"),
  deviceStart: (clientId: string | null) =>
    invoke<DeviceCodeResponse>("github_device_start", { clientId }),
  devicePoll: (clientId: string, deviceCode: string) =>
    invoke<DevicePollResult>("github_device_poll", { clientId, deviceCode }),
  setPat: (pat: string) => invoke<void>("github_set_pat", { pat }),
  logout: () => invoke<void>("github_logout"),
};
