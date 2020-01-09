import {
  BaseSubscriptionOptions,
  MutationFunctionOptions,
  OperationVariables
} from '@apollo/react-common';
import {DataProxy} from 'apollo-cache';
import ApolloClient from 'apollo-client';
import {DocumentNode} from 'apollo-link';
import {resultKeyNameFromField} from 'apollo-utilities';
import {FieldNode, OperationDefinitionNode} from 'graphql';
import produce from 'immer';
import {findArrayInObject, getValueByPath, pick, setValueByPath} from './utils';

type Item = {[key: string]: any};

export enum CacheOperationTypes {
  AUTO = 'auto',
  ADD = 'add',
  REMOVE = 'remove',
  UPDATE = 'update'
}

const prefixesForRemove = [
  'delete',
  'deleted',
  'discard',
  'discarded',
  'erase',
  'erased',
  'remove',
  'removed'
];

const prefixesForUpdate = [
  'update',
  'updated',
  'upsert',
  'upserted',
  'edit',
  'edited',
  'modify',
  'modified',
  'analyze',
  'activate'
];

const prefixesForAdd = [
  'create',
  'created',
  'put',
  'set',
  'add',
  'added',
  'new',
  'insert',
  'inserted',
  'duplicate',
  'import'
];

export type OfflineConfig = {
  prefixesForRemove?: string[];
  prefixesForUpdate?: string[];
  prefixesForAdd?: string[];
  getIdFieldFromObject?: (item: Item) => string;
  idField?: string;
};

const offlineConfig: OfflineConfig = {
  prefixesForRemove,
  prefixesForUpdate,
  prefixesForAdd,
  idField: 'id'
};

export const setConfig = (config: OfflineConfig) => {
  return Object.assign(offlineConfig, config);
};

export const getOpTypeFromOperationName = (opName = ''): CacheOperationTypes => {
  // Note: we do a toLowerCase() and startsWith() to avoid ambiguity with operations like "RemoveAddendum"
  const comparator = (prefix: string) =>
    opName.toLowerCase().startsWith(prefix) || opName.toLowerCase().startsWith(`on${prefix}`);

  let result = CacheOperationTypes.AUTO;
  [
    [offlineConfig.prefixesForAdd, CacheOperationTypes.ADD],
    [offlineConfig.prefixesForRemove, CacheOperationTypes.REMOVE],
    [offlineConfig.prefixesForUpdate, CacheOperationTypes.UPDATE]
  ].forEach(row => {
    const [prefix, type] = row as [string[], CacheOperationTypes];
    if (prefix.some(comparator)) {
      result = type;
      return;
    }
  });

  return result;
};

export const getUpdater = <T extends Item>(
  opType: CacheOperationTypes,
  idField: string
): ((currentValue: T[] | T, newItem?: T) => T[] | T | null | undefined) => {
  switch (opType) {
    case CacheOperationTypes.ADD:
      return (currentValue, newItem) => {
        if (Array.isArray(currentValue)) {
          return newItem
            ? [...currentValue.filter(item => item[idField] !== newItem[idField]), newItem]
            : [...currentValue];
        } else {
          return newItem;
        }
      };
    case CacheOperationTypes.UPDATE:
      return (currentValue, newItem) => {
        if (Array.isArray(currentValue)) {
          return newItem
            ? currentValue.map(item => (item[idField] === newItem[idField] ? newItem : item))
            : [...currentValue];
        } else {
          return {
            ...currentValue,
            ...pick(
              newItem,
              Object.keys(currentValue).filter(key => key !== '__typename')
            )
          };
        }
      };
    case CacheOperationTypes.REMOVE:
      return (currentValue, newItem) => {
        if (Array.isArray(currentValue)) {
          return newItem
            ? currentValue.filter(item => item[idField] !== newItem[idField])
            : [...currentValue];
        } else {
          return null;
        }
      };
    default:
      return currentValue => currentValue;
  }
};

export const getOperationFieldName = (operation: DocumentNode): string =>
  resultKeyNameFromField(
    (operation.definitions[0] as OperationDefinitionNode).selectionSet.selections[0] as FieldNode
  );

export type QueryWithVariables<TVariables = OperationVariables> = {
  query: DocumentNode;
  variables?: TVariables;
};

export type OfflineOptions<TData> = {
  updateQuery?: QueryWithVariables | DocumentNode;
  idField?: string;
  operationType?: CacheOperationTypes;
  mapResultToUpdate?(data: NonNullable<TData>): Item;
};

export type MutationOptions<TData, TVariables> = MutationFunctionOptions<TData, TVariables> &
  OfflineOptions<TData>;

type UpdateCacheOptions<TData = any> = OfflineOptions<TData> & {
  client: ApolloClient<any> | DataProxy;
  data: TData;
};

const updateCache = <TData = any>({
  client,
  data,
  idField,
  updateQuery,
  operationType = CacheOperationTypes.AUTO,
  mapResultToUpdate
}: UpdateCacheOptions<TData>) => {
  if (!data) return;
  const [opFieldName]: string[] = Object.keys(data);
  const opType =
    operationType === CacheOperationTypes.AUTO
      ? getOpTypeFromOperationName(opFieldName)
      : operationType;
  if (!(data as any)[opFieldName]) return;
  const mutatedItem = mapResultToUpdate ? mapResultToUpdate(data!) : (data as any)[opFieldName];
  const query = (updateQuery as QueryWithVariables).query || (updateQuery as DocumentNode);
  const queryVars = (updateQuery as QueryWithVariables).variables || {};
  const queryField = getOperationFieldName(query);
  let cachedQueryResult;
  try {
    // @ts-ignore
    cachedQueryResult = client.readQuery({
      query,
      variables: queryVars
    });
  } catch {
    return;
  }
  if (!cachedQueryResult) return;
  const idFieldName =
    idField || offlineConfig.getIdFieldFromObject?.(mutatedItem) || offlineConfig.idField!;
  const updaterFn = getUpdater(opType, idFieldName);

  const updatedQueryData = produce(cachedQueryResult, (draft: any) => {
    const opResultCachedValue = draft[queryField];
    const path = findArrayInObject(opResultCachedValue);
    const update = updaterFn(getValueByPath(opResultCachedValue, path), mutatedItem);
    if (!path || path.length === 0) {
      draft[queryField] = update;
    } else {
      setValueByPath(opResultCachedValue, path, update);
    }
  });

  // @ts-ignore
  client.writeQuery({query, variables: queryVars, data: updatedQueryData});
};

export const getMutationOptions = <TData = any, TVariables = OperationVariables>({
  updateQuery,
  idField,
  operationType,
  mapResultToUpdate,
  ...options
}: MutationOptions<TData, TVariables>): MutationFunctionOptions<TData, TVariables> => {
  if (!updateQuery || options.update) return options;
  return {
    update: (client, {data}) => {
      updateCache({client, data, idField, mapResultToUpdate, operationType, updateQuery});
    },
    ...options
  };
};

export type SubscriptionOptions<TData, TVariables> = BaseSubscriptionOptions<TData, TVariables> &
  OfflineOptions<TData>;

export const getSubscriptionOptions = <TData = any, TVariables = OperationVariables>({
  updateQuery,
  idField,
  operationType,
  mapResultToUpdate,
  ...options
}: SubscriptionOptions<TData, TVariables>): BaseSubscriptionOptions<TData, TVariables> => {
  if (!updateQuery || options.onSubscriptionData) return options;
  return {
    onSubscriptionData: ({client, subscriptionData: {data}}) => {
      updateCache({client, data, updateQuery, operationType, idField, mapResultToUpdate});
    },
    ...options
  };
};
