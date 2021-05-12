import { getAdminConfig } from '../../config/admin';
import { logger } from '../../logger';
import { Pr, platform } from '../../platform';
import { BranchStatus } from '../../types';
import { deleteBranch, isBranchModified } from '../../util/git';
import { BranchConfig } from '../types';

export enum PrAutomergeBlockReason {
  BranchModified = 'BranchModified',
  BranchNotGreen = 'BranchNotGreen',
  Conflicted = 'Conflicted',
  DryRun = 'DryRun',
  PlatformNotReady = 'PlatformNotReady',
  PlatformRejection = 'PlatformRejection',
}

export type AutomergePrResult = {
  automerged: boolean;
  branchRemoved?: boolean;
  prAutomergeBlockReason?: PrAutomergeBlockReason;
};

export async function checkAutoMerge(
  pr: Pr,
  config: BranchConfig
): Promise<AutomergePrResult> {
  logger.trace({ config }, 'checkAutoMerge');
  const {
    branchName,
    automergeType,
    automergeComment,
    requiredStatusChecks,
    rebaseRequested,
  } = config;
  // Return if PR not ready for automerge
  if (pr.isConflicted) {
    logger.debug('PR is conflicted');
    return {
      automerged: false,
      prAutomergeBlockReason: PrAutomergeBlockReason.Conflicted,
    };
  }
  if (requiredStatusChecks && pr.canMerge !== true) {
    logger.debug(
      { canMergeReason: pr.canMergeReason },
      'PR is not ready for merge'
    );
    return {
      automerged: false,
      prAutomergeBlockReason: PrAutomergeBlockReason.PlatformNotReady,
    };
  }
  const branchStatus = await platform.getBranchStatus(
    branchName,
    requiredStatusChecks
  );
  if (branchStatus !== BranchStatus.green) {
    logger.debug(
      `PR is not ready for merge (branch status is ${branchStatus})`
    );
    return {
      automerged: false,
      prAutomergeBlockReason: PrAutomergeBlockReason.BranchNotGreen,
    };
  }
  // Check if it's been touched
  if (await isBranchModified(branchName)) {
    logger.debug('PR is ready for automerge but has been modified');
    return {
      automerged: false,
      prAutomergeBlockReason: PrAutomergeBlockReason.BranchModified,
    };
  }
  if (automergeType === 'pr-comment') {
    logger.debug(`Applying automerge comment: ${automergeComment}`);
    /* c8 ignore start */
    if (getAdminConfig().dryRun) {
      logger.info(
        `DRY-RUN: Would add PR automerge comment to PR #${pr.number}`
      );
      return {
        automerged: false,
        prAutomergeBlockReason: PrAutomergeBlockReason.DryRun,
      };
    } /* c8 ignore stop */
    if (rebaseRequested) {
      await platform.ensureCommentRemoval({
        number: pr.number,
        content: automergeComment,
      });
    }
    await platform.ensureComment({
      number: pr.number,
      topic: null,
      content: automergeComment,
    });
    return { automerged: true, branchRemoved: false };
  }
  // Let's merge this
  /* c8 ignore start */
  if (getAdminConfig().dryRun) {
    logger.info(`DRY-RUN: Would merge PR #${pr.number}`);
    return {
      automerged: false,
      prAutomergeBlockReason: PrAutomergeBlockReason.DryRun,
    };
  } /* c8 ignore stop */
  logger.debug(`Automerging #${pr.number}`);
  const res = await platform.mergePr(pr.number, branchName);
  if (res) {
    logger.info({ pr: pr.number, prTitle: pr.title }, 'PR automerged');
    let branchRemoved = false;
    try {
      await deleteBranch(branchName);
      branchRemoved = true;
    } catch (err) /* c8 ignore start */ {
      logger.warn({ branchName, err }, 'Branch auto-remove failed');
    } /* c8 ignore stop */
    return { automerged: true, branchRemoved };
  }
  return {
    automerged: false,
    prAutomergeBlockReason: PrAutomergeBlockReason.PlatformRejection,
  };
}
