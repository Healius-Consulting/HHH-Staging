import { dataConnect } from '../../bootstrap/firebase.js';
import { asUuid } from '../../domain/common/uuid.js';

export interface PostcodeSearchSessionRecord {
  id: string;
  postcode: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  resultOrganisationIds: string[];
  expiresAt: string;
  createdAt: string;
}

export interface PostcodeSearchRepositoryPort {
  createSession(input: {
    id: string;
    postcode: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
    resultOrganisationIds: string[];
    expiresAt: string;
  }): Promise<void>;
  findSessionById(id: string): Promise<PostcodeSearchSessionRecord | null>;
}

const CREATE_POSTCODE_SEARCH_SESSION_GQL = `
  mutation CreatePostcodeSearchSession(
    $id: UUID!
    $postcode: String!
    $status: String!
    $latitude: Float
    $longitude: Float
    $resultOrganisationIds: [UUID!]
    $expiresAt: Timestamp!
  ) {
    postcodeSearchSession_insert(data: {
      id: $id
      postcode: $postcode
      status: $status
      latitude: $latitude
      longitude: $longitude
      resultOrganisationIds: $resultOrganisationIds
      expiresAt: $expiresAt
    })
  }
`;

const GET_POSTCODE_SEARCH_SESSION_GQL = `
  query GetPostcodeSearchSession($id: UUID!) {
    postcodeSearchSession(key: { id: $id }) {
      id
      postcode
      status
      latitude
      longitude
      resultOrganisationIds
      expiresAt
      createdAt
    }
  }
`;

export class SqlPostcodeSearchRepository implements PostcodeSearchRepositoryPort {
  async createSession(input: {
    id: string;
    postcode: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
    resultOrganisationIds: string[];
    expiresAt: string;
  }): Promise<void> {
    await dataConnect.executeGraphql<any, any>(CREATE_POSTCODE_SEARCH_SESSION_GQL, {
      variables: input,
    });
  }

  async findSessionById(id: string): Promise<PostcodeSearchSessionRecord | null> {
    const result = await dataConnect.executeGraphql<{ postcodeSearchSession: PostcodeSearchSessionRecord | null }, any>(
      GET_POSTCODE_SEARCH_SESSION_GQL,
      { variables: { id: asUuid(id) } },
    );
    return result.data.postcodeSearchSession ?? null;
  }
}
