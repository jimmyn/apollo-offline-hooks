import ApolloClient from 'apollo-boost';
import {CacheOperationTypes} from 'const';
import 'cross-fetch/polyfill';
import {getOperationFieldName, getOpTypeFromOperationName, getUpdater, updateCache} from 'offline';
import {
  createPostMutation,
  deletePostMutation,
  featuredPostsQuery,
  postsQuery,
  updatePostMutation
} from './operations';

const post1 = Object.freeze({
  __typename: 'post',
  id: 1,
  user_id: 1,
  title: 'A day on the beach',
  date: '2018-01-01'
});

const post2 = Object.freeze({
  __typename: 'post',
  id: 24,
  user_id: 10,
  title: 'Coding for joy',
  date: '2018-12-24'
});

const post3 = Object.freeze({
  __typename: 'post',
  id: 25,
  user_id: 9,
  title: 'On the road',
  date: '2018-12-25'
});

const newPost = Object.freeze({
  __typename: 'post',
  id: 26,
  user_id: 11,
  title: 'New post',
  date: '2018-12-31'
});

const posts = Object.freeze([post1, post2, post3]);

test('getOpTypeFromOperationName', () => {
  expect(getOpTypeFromOperationName('createPost')).toBe(CacheOperationTypes.ADD);
  expect(getOpTypeFromOperationName('newPost')).toBe(CacheOperationTypes.ADD);
  expect(getOpTypeFromOperationName('insertPost')).toBe(CacheOperationTypes.ADD);
  expect(getOpTypeFromOperationName('updatePost')).toBe(CacheOperationTypes.UPDATE);
  expect(getOpTypeFromOperationName('editPost')).toBe(CacheOperationTypes.UPDATE);
  expect(getOpTypeFromOperationName('removePost')).toBe(CacheOperationTypes.REMOVE);
  expect(getOpTypeFromOperationName('deletePost')).toBe(CacheOperationTypes.REMOVE);
});

describe('getUpdater', () => {
  test('updater should add item', () => {
    const updater = getUpdater(CacheOperationTypes.ADD, 'id');
    expect(updater(posts, newPost)).toEqual([...posts, newPost]);
    expect(updater({}, newPost)).toEqual(newPost);
  });

  test('updater should remove item', () => {
    const updater = getUpdater(CacheOperationTypes.REMOVE, 'id');
    expect(updater(posts, {id: 1})).toEqual([post2, post3]);
    expect(updater({}, {id: 1})).toBeNull();
  });

  test('updater should update item', () => {
    const updater = getUpdater(CacheOperationTypes.UPDATE, 'id');
    const updatedPost = {id: post3.id, title: 'Updated post', __typename: 'post'};
    expect(updater(posts, updatedPost)).toEqual([post1, post2, {...post3, ...updatedPost}]);
    expect(updater(post3, updatedPost)).toEqual({...post3, title: 'Updated post'});
  });

  test('getOperationFieldName', () => {
    expect(getOperationFieldName(createPostMutation)).toBe('createPost');
    expect(getOperationFieldName(updatePostMutation)).toBe('updatePost');
    expect(getOperationFieldName(deletePostMutation)).toBe('deletePost');
  });
});

describe('updateCache', () => {
  let client: ApolloClient<any>;
  beforeEach(() => {
    client = new ApolloClient();
    client.writeQuery({
      query: postsQuery,
      data: {posts: [...posts]}
    });
  });

  test('should add item', () => {
    updateCache({
      client,
      data: {createPost: newPost},
      updateQuery: postsQuery
    });

    expect(client.readQuery({query: postsQuery})).toMatchSnapshot();
  });

  test('should not update empty query', () => {
    jest.spyOn(client, 'writeQuery');
    updateCache({
      client,
      data: {createPost: newPost},
      updateQuery: featuredPostsQuery
    });

    expect(client.writeQuery).not.toHaveBeenCalled();
  });

  test('should remove item', () => {
    updateCache({
      client,
      data: {deletePost: post3},
      updateQuery: postsQuery
    });

    expect(client.readQuery({query: postsQuery})).toMatchSnapshot();
  });

  test('should update item', () => {
    const updatedPost = {id: post3.id, title: 'Updated post', __typename: 'post'};
    updateCache({
      client,
      data: {updatePost: updatedPost},
      updateQuery: postsQuery
    });

    expect(client.readQuery({query: postsQuery})).toMatchSnapshot();
  });

  test('should update item with mapResultToUpdate', () => {
    const updatedPost = {id: post3.id, title: 'Updated post', __typename: 'post'};
    updateCache({
      client,
      data: {updatePost: updatedPost},
      mapResultToUpdate(data) {
        return {
          ...data.updatePost,
          title: data.updatePost.title + ' with mapResultToUpdate'
        };
      },
      updateQuery: postsQuery
    });

    expect(client.readQuery({query: postsQuery})).toMatchSnapshot();
  });
});