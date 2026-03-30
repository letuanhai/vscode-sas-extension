// Copyright © 2022-2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";

import {
  AuthType,
  ConnectionType,
  ProfileConfig,
  StudioWebProfile,
  ViyaProfile,
  toAutoExecLines,
} from "../components/profile";
import { getSession as getITCSession } from "./itc";
import { ITCProtocol } from "./itc/types";
import { Config as RestConfig, getSession as getRestSession } from "./rest";
import { Config as StudioWebConfig, getSession as getStudioWebSession } from "./studioweb";
import {
  Error2 as ComputeError,
  LogLine as ComputeLogLine,
  LogLineTypeEnum as ComputeLogLineTypeEnum,
} from "./rest/api/compute";
import { Session } from "./session";
import { getSession as getSSHSession } from "./ssh";

let profileConfig: ProfileConfig;

export type ErrorRepresentation = ComputeError;
export type LogLine = ComputeLogLine;
export type LogLineTypeEnum = ComputeLogLineTypeEnum;
export type OnLogFn = (logs: LogLine[]) => void;

export interface RunResult {
  html5?: string;
  title?: string;
  dataSets?: Array<{ library: string; member: string }>;
}

export interface BaseConfig {
  sasOptions?: string[];
  autoExecLines?: string[];
}

export function getSession(): Session {
  if (!profileConfig) {
    profileConfig = new ProfileConfig();
  }
  // retrieve active & valid profile
  const activeProfile = profileConfig.getActiveProfileDetail();
  const validProfile = profileConfig.validateProfile(activeProfile);

  if (validProfile.type === AuthType.Error) {
    throw new Error(validProfile.error);
  }

  switch (validProfile.profile?.connectionType) {
    case ConnectionType.Rest:
      return getRestSession(toRestConfig(validProfile.profile));
    case ConnectionType.SSH:
      return getSSHSession(validProfile.profile);
    case ConnectionType.COM:
      return getITCSession(validProfile.profile, ITCProtocol.COM);
    case ConnectionType.IOM:
      return getITCSession(validProfile.profile, ITCProtocol.IOMBridge);
    case ConnectionType.StudioWeb:
      return getStudioWebSession(toStudioWebConfig(validProfile.profile));
    default:
      throw new Error(
        l10n.t("Invalid connectionType. Check Profile settings."),
      );
  }
}

/**
 * Translates a {@link ViyaProfile} interface to a {@link RestConfig} interface.
 * @param profile an input {@link ViyaProfile} to translate.
 * @returns RestConfig instance derived from the input profile.
 */
function toRestConfig(profile: ViyaProfile): RestConfig {
  const mapped: RestConfig = profile;
  if (profile.autoExec) {
    mapped.autoExecLines = toAutoExecLines(profile.autoExec);
  }
  return mapped;
}

/**
 * Translates a {@link StudioWebProfile} interface to a {@link StudioWebConfig} interface.
 * @param profile an input StudioWebProfile to translate.
 * @returns StudioWebConfig instance derived from the input profile.
 */
function toStudioWebConfig(profile: StudioWebProfile): StudioWebConfig {
  const mapped: StudioWebConfig = { ...profile };
  if (profile.autoExec) {
    mapped.autoExecLines = toAutoExecLines(profile.autoExec);
  }
  return mapped;
}
