import { reasoningCapability } from '../model-reasoning.mjs'
import { createHash } from 'node:crypto'
import { modelTierFor } from '../model-tier.ts'

export const ACCOUNT_MODEL_ID = /^account-model-[0-9a-f-]{36}$/
export const PRIVATE_PROFILE_ID = /^private-model-[a-f0-9]{40}$/
export const MODEL_NAME = /^.{1,120}$/u
export const MODEL_ID = /^[A-Za-z0-9._:/-]{1,128}$/
const HASH = /^[a-f0-9]{64}$/
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

export function privateProfileId(ownerId, accountModelId, revision) {
  return `private-model-${sha(`weftmate-account-model/v1\n${ownerId}\n${accountModelId}\n${revision}`).slice(0, 40)}`
}

export function publicAccountModel(record, configured = false) {
  const selected = record.revisions[String(record.runtimeRevision)]
  return { accountModelId: record.accountModelId, revision: record.revision,
    profileId: selected.profileId, name: record.name, provider: 'openai-compatible',
    baseUrl: selected.baseUrl, modelId: selected.modelId,
    modelTier: selected.modelTier ?? 'auto', sourceKind: modelTierFor(selected),
    routeFingerprint: selected.routeFingerprint, configured: configured === true,
    deepThinking: reasoningCapability({baseUrl:selected.baseUrl,model:selected.modelId}),
    status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt }
}

export function publicModelOperation(record) {
  return Object.fromEntries(['requestId', 'kind', 'accountModelId', 'status',
    'expectedRevision', 'resultRevision', 'reasonCode', 'errorCode', 'testResult', 'createdAt', 'updatedAt']
    .filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]))
}

export function validAccountModel(record, ownerId, accountModelId) {
  if (!plain(record) || !ACCOUNT_MODEL_ID.test(accountModelId) ||
      record.accountModelId !== accountModelId || record.ownerId !== ownerId ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision > 1000 ||
      !Number.isSafeInteger(record.runtimeRevision) || record.runtimeRevision < 1 ||
      record.runtimeRevision > record.revision ||
      typeof record.name !== 'string' || !MODEL_NAME.test(record.name) || !record.name.trim() ||
      !['pending', 'failed', 'active', 'stopped', 'removed'].includes(record.status) ||
      !TIME.test(record.createdAt ?? '') || !TIME.test(record.updatedAt ?? '') ||
      !plain(record.revisions) || Object.keys(record.revisions).length !== record.runtimeRevision ||
      Object.keys(record).some((key) => !['accountModelId', 'ownerId', 'revision', 'runtimeRevision', 'name',
        'status', 'revisions', 'createdAt', 'updatedAt'].includes(key))) return false
  for (let revision = 1; revision <= record.runtimeRevision; revision++) {
    const row = record.revisions[String(revision)]
    if (!plain(row) || row.revision !== revision ||
        row.profileId !== privateProfileId(ownerId, accountModelId, revision) ||
        typeof row.baseUrl !== 'string' || row.baseUrl.length > 2048 ||
        !/^https?:\/\//.test(row.baseUrl) || !MODEL_ID.test(row.modelId ?? '') ||
        row.routeFingerprint !== null && !HASH.test(row.routeFingerprint ?? '') ||
        row.modelTier !== undefined && !['auto', 'local', 'cloud'].includes(row.modelTier) ||
        !TIME.test(row.createdAt ?? '') ||
        Object.keys(row).some((key) => !['revision', 'profileId', 'baseUrl', 'modelId',
          'routeFingerprint', 'modelTier', 'createdAt'].includes(key))) return false
  }
  return true
}

export function validModelOperation(record, ownerId, requestId, models) {
  if (!plain(record) || record.ownerId !== ownerId || record.requestId !== requestId ||
      !['create', 'update', 'test', 'stop_using', 'remove'].includes(record.kind) ||
      !ACCOUNT_MODEL_ID.test(record.accountModelId ?? '') ||
      !models[record.accountModelId] || !HASH.test(record.payloadHash ?? '') ||
      !['pending', 'applying', 'succeeded', 'failed', 'uncertain'].includes(record.status) ||
      !TIME.test(record.createdAt ?? '') || !TIME.test(record.updatedAt ?? '') ||
      record.expectedRevision !== undefined &&
        (!Number.isSafeInteger(record.expectedRevision) || record.expectedRevision < 1) ||
      record.resultRevision !== undefined &&
        (!Number.isSafeInteger(record.resultRevision) || record.resultRevision < 1) ||
      record.reasonCode !== undefined && !/^[A-Z_]{2,64}$/.test(record.reasonCode) ||
      record.errorCode !== undefined && !/^[A-Z_]{2,64}$/.test(record.errorCode) ||
      record.name !== undefined && (typeof record.name !== 'string' ||
        !record.name.trim() || record.name.length > 120) ||
      record.testResult !== undefined && (!plain(record.testResult) ||
        typeof record.testResult.configured !== 'boolean' ||
        typeof record.testResult.reachable !== 'boolean' ||
        typeof record.testResult.modelListed !== 'boolean' ||
        Object.keys(record.testResult).some((key) =>
          !['configured', 'reachable', 'modelListed', 'inferenceVerified', 'address', 'authentication', 'catalog', 'model', 'httpStatus', 'requiresTestMessage', 'suggestedModelId'].includes(key))) ||
      record.stageRef !== undefined && !/^pending-model-[a-f0-9]{48}$/.test(record.stageRef) ||
      record.previousProfileId !== undefined && !PRIVATE_PROFILE_ID.test(record.previousProfileId) ||
      record.target !== undefined && (!plain(record.target) ||
        !Number.isSafeInteger(record.target.runtimeRevision) || record.target.runtimeRevision < 1 ||
        record.target.profileId !== privateProfileId(ownerId, record.accountModelId, record.target.runtimeRevision) ||
        typeof record.target.baseUrl !== 'string' || record.target.baseUrl.length > 2048 ||
        !/^https?:\/\//.test(record.target.baseUrl) || !MODEL_ID.test(record.target.modelId ?? '') ||
        typeof record.target.name !== 'string' || !record.target.name.trim() ||
        record.target.name.length > 120 ||
        record.target.modelTier !== undefined && !['auto', 'local', 'cloud'].includes(record.target.modelTier) ||
        record.target.routeFingerprint !== null && !HASH.test(record.target.routeFingerprint ?? '') ||
        Object.keys(record.target).some((key) => !['runtimeRevision', 'profileId', 'baseUrl',
          'modelId', 'name', 'routeFingerprint', 'modelTier'].includes(key))) ||
      Object.keys(record).some((key) => !['ownerId', 'requestId', 'kind', 'accountModelId',
        'payloadHash', 'status', 'expectedRevision', 'resultRevision', 'reasonCode',
        'errorCode', 'testResult', 'createdAt', 'updatedAt', 'target', 'stageRef',
        'previousProfileId', 'name'].includes(key))) return false
  return true
}
