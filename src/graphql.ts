import {ApolloServer} from '@saeris/apollo-server-vercel'
import cheerio from 'cheerio'
import nodeFetch from 'node-fetch'
import qs from 'qs'
import {
  GraphQLInt,
  GraphQLInterfaceType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString
} from 'graphql'
import graphqlFields from 'graphql-fields'
import type {GraphQLFieldConfig, GraphQLFieldConfigMap} from 'graphql'
import type {Response} from 'node-fetch'

interface WithUpdated {
  readonly updated: string
}

type HomePageStat =
  | 'activeCases'
  | 'deaths'
  | 'hotelCases'
  | 'interstateCases'
  | 'localCases'
  | 'tests'

type HomePageStatsOnly = Readonly<Record<HomePageStat, string>>

type HomePageStats = HomePageStatsOnly & WithUpdated

const nonNullString: GraphQLFieldConfig<unknown, unknown> = {
  type: new GraphQLNonNull(GraphQLString)
}

const updatedField: GraphQLFieldConfigMap<unknown, unknown> = {
  updated: nonNullString
}

const withUpdated = new GraphQLInterfaceType({
  name: 'WithUpdated',
  fields: updatedField
})

/* eslint-disable @typescript-eslint/ban-types -- object and {} */
type Fields<T extends object> = {
  [K in keyof T]?: T[K] extends object
    ? T[K] extends readonly (infer U)[]
      ? U extends object
        ? Fields<U>
        : {}
      : Fields<T[K]>
    : {}
}
/* eslint-enable @typescript-eslint/ban-types */

const NAME_TO_IDS: Readonly<Record<HomePageStat, string>> = {
  localCases: 'c429cc59-6887-4093-a937-e7592485f293',
  interstateCases: '2e5c92a1-1c9d-48c9-adf5-a56f096ad99f',
  hotelCases: '05f695de-a635-4c35-a6d1-b6a3d63e02de',
  deaths: 'd7d13b8d-4a41-435f-8e82-b8d1d5475027',
  activeCases: '9d3a45ca-4e54-4545-9159-d09197bc45d4',
  tests: '179c4b61-2d74-4472-ac94-9c979a39793d'
  // hospitalCases: '0c37c1dc-01ad-42c4-88b3-acdf4a1eea88',
  // icuCases: 'a7bfc1e1-1b7f-4335-8a15-cd585e1cb6df'
}

const IDS_TO_NAME: Readonly<Record<string, HomePageStat>> = Object.fromEntries(
  (
    Object.entries(NAME_TO_IDS) as readonly (readonly [HomePageStat, string])[]
  ).map(([name, id]) => [id, name])
)

const fetch = async (url: string, accept?: string): Promise<Response> => {
  const response = await nodeFetch(
    url,
    accept === undefined ? undefined : {headers: {accept}}
  )
  if (!response.ok) throw new Error(response.statusText)
  return response
}

const fetchJSON = async <T>(...args: Parameters<typeof fetch>): Promise<T> =>
  (await fetch(...args)).json() as Promise<T>

const fetchJSONAPI = async <T>(url: string, message: string): Promise<T> => {
  const response = await fetchJSON<
    | {
        readonly data: T
      }
    | {
        readonly errors: readonly unknown[]
      }
  >(url, 'application/vnd.api+json')
  if ('errors' in response)
    throw new Error(`${message}: ${JSON.stringify(response.errors, null, 2)}`)
  return response.data
}

/* fetchJSONAPI<{
  readonly attributes: {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- API response
    readonly field_paragraph_body: {readonly processed: string}
  }
}>(
  'https://content.vic.gov.au/api/v1/paragraph/basic_text/7672e694-4dce-4f07-81fb-638b689bb242',
  'fetching case stats updated text failed'
).then(({attributes}) =>
  attributes.field_paragraph_body.processed.slice(
    '<h2>Updated: '.length,
    -'</h2>'.length
  )
) */

export default new ApolloServer({
  schema: new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: {
        homePageStats: {
          type: new GraphQLNonNull(
            new GraphQLObjectType({
              name: 'HomePageStats',
              interfaces: [withUpdated],
              fields: {
                ...updatedField,
                ...Object.fromEntries(
                  [
                    'localCases',
                    'interstateCases',
                    'hotelCases',
                    'deaths',
                    'activeCases',
                    'tests'
                  ].map(s => [s, nonNullString])
                )
              }
            })
          ),
          resolve: async (
            _,
            __,
            ___,
            info
          ): Promise<Partial<HomePageStats>> => {
            const fields = Object.keys(
              graphqlFields(info) as Fields<HomePageStats>
            ) as readonly (keyof HomePageStats)[]
            const [updated, stats] = await Promise.all([
              fetch('https://www.coronavirus.vic.gov.au').then(async response =>
                cheerio
                  .load(await response.text())('.ch-daily-update__intro-title')
                  .text()
                  .slice(
                    ' COVID-19 in Victoria, '.length,
                    -' (last 24 hours )'.length
                  )
              ),
              fetchJSONAPI<
                readonly {
                  readonly id: string
                  readonly attributes: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention -- API response
                    readonly field_item_statistic: string
                  }
                }[]
              >(
                `https://content.vic.gov.au/api/v1/paragraph/daily_update_statistics?${qs.stringify(
                  {
                    filter: {
                      c: {
                        path: 'id',
                        operator: 'IN',
                        value: fields
                          .filter(
                            (field): field is HomePageStat =>
                              field !== 'updated'
                          )
                          .map(field => NAME_TO_IDS[field])
                      }
                    }
                  }
                )}`,
                'fetching homepage stats updated text failed'
              ).then<Partial<HomePageStatsOnly>>(data =>
                Object.fromEntries(
                  data.map(({id, attributes: {field_item_statistic: stat}}) => [
                    IDS_TO_NAME[id]!,
                    stat
                  ])
                )
              )
            ])
            return {updated, ...stats}
          }
        },
        exposureSites: {
          type: new GraphQLNonNull(
            new GraphQLObjectType({
              name: 'ExposureSites',
              fields: {
                count: {
                  type: new GraphQLNonNull(GraphQLInt)
                }
              }
            })
          ),
          resolve: async (): Promise<{readonly count: number}> => {
            const data = await fetchJSON<
              | {
                  success: false
                  error: unknown
                }
              | {success: true; result: {total: number}}
            >(
              'https://www.coronavirus.vic.gov.au/sdp-ckan?resource_id=afb52611-6061-4a2b-9110-74c920bede77&limit=0',
              'application/json'
            )
            if (!data.success) {
              throw new Error(
                `fetching exposure sites failed: ${JSON.stringify(
                  data.error,
                  null,
                  2
                )}`
              )
            }
            return {count: data.result.total}
          }
        }
      }
    })
  })
}).createHandler()
