import {ApolloServer} from '@saeris/apollo-server-vercel'
import {GraphQLDateTime} from 'graphql-scalars'
import nodeFetch from 'node-fetch'
import qs from 'qs'
import {
  GraphQLFieldResolver,
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

// #region Types

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

type WithUpdated<T> = T & {
  readonly updated: string
}

type Stats<T extends string> = Readonly<Record<T, string>>

const homePageStats = [
  'localCases',
  'interstateCases',
  'hotelCases',
  'deaths',
  'activeCases',
  'tests'
] as const
type HomePageStat = typeof homePageStats[number]

const dataPageStats = [
  'totalCases',
  'totalDeaths',
  'recovered',
  'totalTests',
  'hospitalCases',
  'icuCases'
] as const
type DataPageStat = typeof dataPageStats[number]

interface AllStats {
  homePage: WithUpdated<Stats<HomePageStat>>
  dataPage: WithUpdated<Stats<DataPageStat>>
}

type AnyStat = DataPageStat | HomePageStat

// #endregion

// #region Constants

const COVID_SITE = 'https://www.coronavirus.vic.gov.au'
const ABC_SITE = 'https://www.abc.net.au'

const NAME_TO_IDS: Readonly<Record<AnyStat, string>> = {
  localCases: 'c429cc59-6887-4093-a937-e7592485f293',
  interstateCases: '2e5c92a1-1c9d-48c9-adf5-a56f096ad99f',
  hotelCases: '05f695de-a635-4c35-a6d1-b6a3d63e02de',
  activeCases: '9d3a45ca-4e54-4545-9159-d09197bc45d4',
  totalCases: '2612d038-ca63-4cfd-beeb-8ad0a6d83c0e',
  deaths: 'd7d13b8d-4a41-435f-8e82-b8d1d5475027',
  totalDeaths: '0e539187-308d-4924-a9df-31df1d1407fe',
  recovered: '4d573de6-a0b9-4cb6-b45b-9b0e018f7149',
  tests: '179c4b61-2d74-4472-ac94-9c979a39793d',
  totalTests: '35208240-6a54-468b-9b6c-b9a0252ce5af',
  hospitalCases: '0c37c1dc-01ad-42c4-88b3-acdf4a1eea88',
  icuCases: 'a7bfc1e1-1b7f-4335-8a15-cd585e1cb6df'
}

const IDS_TO_NAME: Readonly<Record<string, AnyStat>> = Object.fromEntries(
  (
    Object.entries(NAME_TO_IDS) as readonly (readonly [HomePageStat, string])[]
  ).map(([name, id]) => [id, name])
)

// #endregion

// #region Utils

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

const covidAPI = async <T>(
  path: string,
  message: string,
  query?: Record<string, unknown>
): Promise<T> => {
  const response = await fetchJSON<
    | {
        readonly data: T
      }
    | {
        readonly errors: readonly unknown[]
      }
  >(
    `https://content.vic.gov.au/api/v1/${path}${
      query ? `?${qs.stringify(query)}` : ''
    }`,
    'application/vnd.api+json'
  )
  if ('errors' in response) {
    throw new Error(
      `fetching ${message} failed: ${JSON.stringify(response.errors, null, 2)}`
    )
  }
  return response.data
}

const fetchUpdated = async (path: string, message: string): Promise<string> =>
  (
    await covidAPI<{
      readonly attributes: {
        readonly changed: string
      }
    }>(path, `${message} updated`, {
      fields: {'block_content--daily_update': 'changed'}
    })
  ).attributes.changed

// #endregion

// #region GraphQL Utils

const nonNullString = {
  type: new GraphQLNonNull(GraphQLString)
}

const updatedField: GraphQLFieldConfigMap<unknown, unknown> = {
  updated: {type: new GraphQLNonNull(GraphQLDateTime)}
}

const withUpdatedInterface = new GraphQLInterfaceType({
  name: 'WithUpdated',
  fields: updatedField
})

const withUpdated = (
  name: string,
  description: string,
  fields: GraphQLFieldConfigMap<unknown, unknown>,
  resolve?: GraphQLFieldResolver<unknown, unknown>
): GraphQLFieldConfig<unknown, unknown> => ({
  description,
  type: new GraphQLNonNull(
    new GraphQLObjectType({
      name,
      interfaces: [withUpdatedInterface],
      fields: {
        ...updatedField,
        ...fields
      }
    })
  ),
  ...(resolve ? {resolve} : {})
})

const statsField = (
  name: string,
  description: string,
  statKeys: readonly AnyStat[]
): GraphQLFieldConfig<unknown, unknown> =>
  withUpdated(
    name,
    description,
    Object.fromEntries(statKeys.map(s => [s, nonNullString]))
  )

// #endregion

const vaccinationStatFields = {
  vaxRate: nonNullString,
  vaxRateDelta: nonNullString,
  vax2Rate: nonNullString,
  vax2RateDelta: nonNullString
}

export default new ApolloServer({
  schema: new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: {
        stats: {
          type: new GraphQLNonNull(
            new GraphQLObjectType({
              name: 'Stats',
              fields: {
                homePage: statsField(
                  'HomePageStats',
                  COVID_SITE,
                  homePageStats
                ),
                dataPage: statsField(
                  'DataPageStats',
                  `${COVID_SITE}/victorian-coronavirus-covid-19-data`,
                  dataPageStats
                )
              }
            })
          ),
          resolve: async (
            _,
            __,
            ___,
            info
          ): Promise<
            {
              [K in keyof AllStats]?: {
                [L in keyof AllStats[K]]?: AllStats[K][L] | undefined
              }
            }
          > => {
            const fields = graphqlFields(info) as Fields<AllStats>
            const [
              homePageUpdated,
              dataPageUpdated,
              {
                localCases,
                interstateCases,
                hotelCases,
                activeCases,
                totalCases,
                deaths,
                totalDeaths,
                recovered,
                tests,
                totalTests,
                hospitalCases,
                icuCases
              }
            ] = await Promise.all([
              fields.homePage?.updated
                ? fetchUpdated(
                    'block_content/daily_update/743c618f-deb7-4f00-9eb3-c4abc1171663',
                    'home page'
                  )
                : undefined,
              fields.dataPage?.updated
                ? fetchUpdated(
                    'block_content/daily_update/e674178a-0717-44c1-a14f-514db0e1dc65',
                    'data page'
                  )
                : undefined,
              covidAPI<
                readonly {
                  readonly id: string
                  readonly attributes: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention -- api
                    readonly field_item_statistic: string
                  }
                }[]
              >('paragraph/daily_update_statistics', 'stats', {
                fields: {
                  // eslint-disable-next-line @typescript-eslint/naming-convention -- api
                  'paragraph--daily_update_statistics': 'field_item_statistic'
                },
                filter: {
                  c: {
                    path: 'id',
                    operator: 'IN',
                    value: (
                      Object.values(fields).flatMap(Object.keys) as readonly (
                        | AnyStat
                        | 'updated'
                      )[]
                    )
                      .filter((field): field is AnyStat => field !== 'updated')
                      .map(field => NAME_TO_IDS[field])
                  }
                }
              }).then(
                data =>
                  Object.fromEntries(
                    data.map(
                      ({id, attributes: {field_item_statistic: stat}}) => [
                        IDS_TO_NAME[id]!,
                        stat
                      ]
                    )
                  ) as Partial<Stats<AnyStat>>
              )
            ])
            return {
              homePage: {
                updated: homePageUpdated,
                localCases,
                interstateCases,
                hotelCases,
                activeCases,
                deaths,
                tests
              },
              dataPage: {
                updated: dataPageUpdated,
                totalCases,
                totalDeaths,
                recovered,
                totalTests,
                hospitalCases,
                icuCases
              }
            }
          }
        },
        exposureSites: {
          description: `${COVID_SITE}/case-alerts–public-exposure-sites`,
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
        },
        vaccinationStats: withUpdated(
          'VaccinationStats',
          `${ABC_SITE}/news/2021-03-02/charting-australias-covid-vaccine-rollout/13197518`,
          vaccinationStatFields,
          async (): Promise<
            WithUpdated<
              Readonly<Record<keyof typeof vaccinationStatFields, string>>
            >
          > => {
            type Row = readonly [
              date: string,
              place: string,
              totalFirst: string,
              totalFirstPct: string,
              totalSecond: string,
              totalSecondPct: string
            ]
            const [
              [, , , yesterday1, , yesterday2],
              [updated, , , today1, , today2]
            ] = (
              await (
                await fetch(
                  `${ABC_SITE}/dat/news/interactives/covid19-data//aus-doses-breakdown.csv`
                )
              ).text()
            )
              .split('\r\n')
              .slice(-18) // 2 * (8 states/territories + national)
              .map(line => line.split(',') as unknown as Row)
              .filter(([, place]) => place === 'VIC') as unknown as readonly [
              yesterday: Row,
              today: Row
            ]
            const vaxRate = Number(today1)
            return {
              updated,
              vaxRate: vaxRate.toFixed(2),
              vaxRateDelta: (vaxRate - Number(yesterday1)).toFixed(2),
              vax2Rate: today2,
              vax2RateDelta: (Number(today2) - Number(yesterday2)).toFixed(2)
            }
          }
        )
      }
    })
  })
}).createHandler()
