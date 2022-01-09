import { ApolloServer } from '@saeris/apollo-server-vercel';
import { GraphQLInterfaceType, GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import graphqlFields from 'graphql-fields';
import { GraphQLDateTime } from 'graphql-scalars';
import nodeFetch from 'node-fetch';
import qs from 'qs';
const homePageStats = [
    'dose1',
    'dose2',
    'dose3',
    'newCases',
    'pcrTests',
    'newRATCases',
    'newHospitalCases',
    'icuCases',
    'deaths'
];
const dataPageStats = [
    'newPCRCases',
    'newHotelCases',
    'activeCases',
    'totalPCRTests',
    'totalPCRCases',
    'totalDeaths',
    'recovered'
];
// #endregion
// #region Constants
const COVID_SITE = 'https://www.coronavirus.vic.gov.au';
const NAME_TO_IDS = {
    dose1: 'bd3dad0d-5c68-4fc6-a392-e7f22f1e734d',
    dose2: 'a95c18ed-7111-4e54-9936-5ec4fe135058',
    dose3: '74b2a8a1-4edb-4cb2-96d5-d1bf96ec3b21',
    newCases: 'c429cc59-6887-4093-a937-e7592485f293',
    pcrTests: '05f695de-a635-4c35-a6d1-b6a3d63e02de',
    newRATCases: 'd7d13b8d-4a41-435f-8e82-b8d1d5475027',
    newHospitalCases: '9d3a45ca-4e54-4545-9159-d09197bc45d4',
    icuCases: '2e5c92a1-1c9d-48c9-adf5-a56f096ad99f',
    deaths: '179c4b61-2d74-4472-ac94-9c979a39793d',
    newPCRCases: '293615f7-f87f-4bc0-954c-1bb53989e6fc',
    newHotelCases: '5c5d8d1b-89e3-4a5e-9fcf-0b93da140e9d',
    activeCases: 'a0681e4b-82d0-4188-a6d3-b3f2789dd110',
    totalPCRTests: '35208240-6a54-468b-9b6c-b9a0252ce5af',
    totalPCRCases: '2612d038-ca63-4cfd-beeb-8ad0a6d83c0e',
    totalDeaths: '0e539187-308d-4924-a9df-31df1d1407fe',
    recovered: '4d573de6-a0b9-4cb6-b45b-9b0e018f7149'
};
const IDS_TO_NAME = Object.fromEntries(Object.entries(NAME_TO_IDS).map(([name, id]) => [id, name]));
// #endregion
// #region Utils
const fetch = async (url, accept) => {
    const response = await nodeFetch(url, accept === undefined ? undefined : { headers: { accept } });
    if (!response.ok)
        throw new Error(response.statusText);
    return response;
};
const fetchJSON = async (...args) => (await fetch(...args)).json();
const covidAPI = async (path, message, query) => {
    const response = await fetchJSON(`https://content.vic.gov.au/api/v1/${path}${query ? `?${qs.stringify(query)}` : ''}`, 'application/vnd.api+json');
    if ('errors' in response) {
        throw new Error(`fetching ${message} failed: ${JSON.stringify(response.errors, null, 2)}`);
    }
    return response.data;
};
const fetchUpdated = async (id, message) => (await covidAPI(`block_content/daily_update/${id}`, `${message} updated`, {
    fields: { 'block_content--daily_update': 'changed' }
})).attributes.changed;
// #endregion
// #region GraphQL Utils
const nonNullString = {
    type: new GraphQLNonNull(GraphQLString)
};
const updatedFields = {
    updated: { type: new GraphQLNonNull(GraphQLDateTime) }
};
const dateTimeUpdatedInterface = new GraphQLInterfaceType({
    name: 'DateTimeUpdated',
    fields: updatedFields
});
const statsField = (name, description, statKeys) => ({
    description,
    type: new GraphQLNonNull(new GraphQLObjectType({
        name,
        interfaces: [dateTimeUpdatedInterface],
        fields: {
            ...updatedFields,
            ...Object.fromEntries(statKeys.map(s => [s, nonNullString]))
        }
    }))
});
// #endregion
export default new ApolloServer({
    introspection: true,
    playground: true,
    schema: new GraphQLSchema({
        query: new GraphQLObjectType({
            name: 'Query',
            fields: {
                stats: {
                    type: new GraphQLNonNull(new GraphQLObjectType({
                        name: 'Stats',
                        fields: {
                            homePage: statsField('HomePageStats', COVID_SITE, homePageStats),
                            dataPage: statsField('DataPageStats', `${COVID_SITE}/victorian-coronavirus-covid-19-data`, dataPageStats)
                        }
                    })),
                    resolve: async (_, __, ___, info) => {
                        const fields = graphqlFields(info);
                        const [homePageUpdated, dataPageUpdated, { dose1, dose2, dose3, newCases, pcrTests, newRATCases, newHospitalCases, icuCases, deaths, newPCRCases, newHotelCases, activeCases, totalPCRTests, totalPCRCases, totalDeaths, recovered }] = await Promise.all([
                            fields.homePage?.updated
                                ? fetchUpdated('743c618f-deb7-4f00-9eb3-c4abc1171663', 'home page')
                                : undefined,
                            fields.dataPage?.updated
                                ? fetchUpdated('e674178a-0717-44c1-a14f-514db0e1dc65', 'data page')
                                : undefined,
                            covidAPI('paragraph/daily_update_statistics', 'stats', {
                                fields: {
                                    'paragraph--daily_update_statistics': 'field_item_statistic'
                                },
                                filter: {
                                    c: {
                                        path: 'id',
                                        operator: 'IN',
                                        value: Object.values(fields).flatMap(Object.keys)
                                            .filter((field) => field !== 'updated')
                                            .map(field => NAME_TO_IDS[field])
                                    }
                                }
                            }).then(data => Object.fromEntries(data.map(({ id, attributes: { field_item_statistic: stat } }) => [
                                IDS_TO_NAME[id],
                                stat
                            ])))
                        ]);
                        return {
                            homePage: {
                                updated: homePageUpdated,
                                dose1,
                                dose2,
                                dose3,
                                newCases,
                                pcrTests,
                                newRATCases,
                                newHospitalCases,
                                icuCases,
                                deaths
                            },
                            dataPage: {
                                updated: dataPageUpdated,
                                newPCRCases,
                                newHotelCases,
                                activeCases,
                                totalPCRTests,
                                totalPCRCases,
                                totalDeaths,
                                recovered
                            }
                        };
                    }
                }
            }
        })
    })
}).createHandler({ cors: { origin: '*' } });
