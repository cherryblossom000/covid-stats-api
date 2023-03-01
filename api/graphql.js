import { ApolloServer } from '@saeris/apollo-server-vercel';
import { GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString, } from 'graphql';
import graphqlFields from 'graphql-fields';
import { GraphQLDate, GraphQLDateTime } from 'graphql-scalars';
import qs from 'qs';
import { request } from 'undici';
const weeklyStats = {
    newCases: 'total cases for the past week',
    activeCases: 'total active cases',
    averageHospitalCases: 'cases in hospital (7-day rolling average)',
    averageICUCases: 'cases in ICU (7-day rolling average)',
    averagePCRTests: 'PCR tests (7-day rolling average)',
    averagePositiveRATs: 'positive RATs (7-day rolling average)',
    totalPCRCases: 'total cases from PCR',
    averageDeaths: 'lives lost on average each day over the past week',
    totalDeaths: 'total lives lost',
    totalRecovered: 'cases recovered',
};
const vaxPctStats = {
    dose1: '12+ eligible Victorians first dose',
    dose2: '12+ eligible Victorians second dose',
    dose3: '18+ eligible Victorians third dose',
};
const vaxTotalStats = {
    newDoses: 'Total doses administered this week',
    totalDoses: 'Total doses administered',
    newAustralianDoses: 'Doses administered by Australian Government',
    newVictorianDoses: 'Doses administered by Victorian Government',
};
// #endregion
// #region Constants
const COVID_SITE = 'https://www.coronavirus.vic.gov.au';
const MONTHS = {
    /* eslint-disable @typescript-eslint/naming-convention -- months */
    January: '01',
    February: '02',
    March: '03',
    April: '04',
    May: '05',
    June: '06',
    July: '07',
    August: '08',
    September: '09',
    October: '10',
    November: '11',
    December: '12',
    /* eslint-enable @typescript-eslint/naming-convention */
};
const WEEKLY_UPDATED_ID = '748ad06f-7143-47f1-8006-1347e9d4dd10';
const VAX_PCTS_UPDATED_ID = '27c3f771-fdee-4fe9-a014-88c611b81de0';
const VAX_TOTALS_WEEK_ID = '91d22388-aff5-4278-b8a7-aa6357cdf389';
const nameIdMap = (toIds) => {
    const toNames = Object.fromEntries(Object.entries(toIds).map(([k, v]) => [v, k]));
    return { fromName: name => toIds[name], fromId: id => toNames[id] };
};
const weeklyIds = nameIdMap({
    newCases: '8e545be4-b7ab-4f9b-a04e-eb0ba4c815b8',
    activeCases: 'ec10956c-4f49-4dbf-b751-05e353ef6f27',
    averageHospitalCases: '589143cd-192c-4813-9aa2-ddaffd02d075',
    averageICUCases: 'b7db172d-7f4c-4cba-9bf0-f987591411fc',
    averagePCRTests: '957201dc-ed78-4246-9f21-53e7b035d570',
    averagePositiveRATs: 'f862f783-74a1-4479-b096-ae9167e58525',
    totalPCRCases: 'b725902f-6878-4829-b9eb-35d605a1be34',
    averageDeaths: 'a481ad4b-fb95-4645-91fa-19a0eeb2a3cf',
    totalDeaths: '69a44e8d-e04b-4c9a-ad7e-4dda9c662ad2',
    totalRecovered: '9c9481a7-d67b-4815-9a2d-bb6d71c1a774',
});
const vaxIds = nameIdMap({
    dose1: 'd675c960-cb31-4d94-8b18-dd31b6454aff',
    dose2: '4d5012f2-b692-459b-b07f-c91617fcb0d9',
    dose3: '11fe8010-615b-480b-8af3-8810c914c6f7',
    newDoses: '324e92eb-e063-4b00-89f5-50413978d839',
    totalDoses: 'fce9c2cb-a847-494f-b6b4-7e557e5e5000',
    newAustralianDoses: 'd0d0089f-fbbd-457e-aa01-7804030c49e4',
    newVictorianDoses: '1676357f-540c-49c1-8f09-a79917cc8e84',
});
const HOME_PAGE_UPDATED_RE = /Data last updated .+?day(?:&nbsp;| )(\d\d?)(?:&nbsp;| )(\w+?) (\d{4})/u;
const parseHomePageDate = (text) => {
    const [, day, month, year] = HOME_PAGE_UPDATED_RE.exec(text);
    return `${year}-${MONTHS[month]}-${day.padStart(2, '0')}`;
};
const DATA_PAGE_UPDATED_RE = /Updated:( \d\d?|&nbsp;) (\w+?) (\d{4}) (\d\d?):(\d\d?) (a|p)m/u;
const parseDataPageDate = (text) => {
    const [, day, month, year, hour, minute, aOrP] = DATA_PAGE_UPDATED_RE.exec(text);
    const hourNum = Number(hour);
    const isAM = aOrP === 'a';
    return `${year}-${MONTHS[month]}-${day === '&nbsp;' ? '01' : day.slice(1).padStart(2, '0')}T${hourNum === 12
        ? isAM
            ? '00'
            : '12'
        : isAM
            ? String(hourNum).padStart(2, '0')
            : hourNum + 12}:${minute}:00+10:00`;
};
const WEEKLY_WEEK_RE = /Data from (.+?)\./u;
const VAX_TOTALS_WEEK_RE = /From (.+?)</u;
const parseWeek = (re) => (text) => re.exec(text)[1];
// #endregion
// #region Utils
const notUpdated = (x) => x !== 'updated';
const fetch = async (url, accept, message) => {
    const { statusCode, body } = await request(url, accept === undefined ? undefined : { headers: { accept } });
    if (statusCode !== 200) {
        throw new Error(`HTTP status code ${statusCode}${message === undefined ? '' : ` ${message}`}`);
    }
    return body;
};
const fetchJSON = async (...args) => (await fetch(...args)).json();
const covidAPI = async (path, message, query) => {
    const response = await fetchJSON(`https://content.vic.gov.au/api/v1/${path}${query ? `?${qs.stringify(query)}` : ''}`, 'application/vnd.api+json', `fetching ${message}`);
    if ('errors' in response) {
        throw new Error(`fetching ${message} failed: ${JSON.stringify(response.errors, null, 2)}`);
    }
    return response.data;
};
const fetchParagraph = async (id, message) => (await covidAPI(`paragraph/basic_text/${id}`, message, {
    fields: { 'paragraph--basic_text': 'field_paragraph_body' },
})).attributes.field_paragraph_body.value;
const nonNullString = new GraphQLNonNull(GraphQLString);
const mkUpdatedField = (type, description) => ({
    type: new GraphQLNonNull(type),
    description,
});
const dateUpdatedField = mkUpdatedField(GraphQLDate);
const graphqlObject = (config) => 
// TODO: fix types
new GraphQLNonNull(new GraphQLObjectType(config));
const statsField = (name, description, stats, { updated, weekExample } = {}) => ({
    description,
    type: graphqlObject({
        name,
        fields: {
            ...(updated ? { updated } : {}),
            ...(weekExample === undefined
                ? {}
                : {
                    week: {
                        description: `The week that these statistics are for. This will be a range of dates, such as ‘${weekExample}’.`,
                        type: nonNullString,
                    },
                }),
            ...Object.fromEntries(Object.entries(stats).map(([statName, statDescription]) => [
                statName,
                { description: statDescription, type: nonNullString },
            ])),
        },
    }),
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
                    type: graphqlObject({
                        name: 'Stats',
                        fields: {
                            weekly: statsField('WeeklyMainStats', `${COVID_SITE}/victorian-coronavirus-covid-19-data`, weeklyStats, {
                                updated: mkUpdatedField(GraphQLDateTime, 'If the day isn’t available on the website it will default to the 1st.'),
                                weekExample: 'Friday 16 September 2022 - Thursday 22 September 2022',
                            }),
                            vax: {
                                description: 'Vaccination statistics',
                                type: graphqlObject({
                                    name: 'VaxStats',
                                    fields: {
                                        percentages: statsField('VaxPercentageStats', COVID_SITE, vaxPctStats, { updated: dateUpdatedField }),
                                        totals: statsField('VaxTotalStats', `${COVID_SITE}/weekly-covid-19-vaccine-data`, vaxTotalStats, { weekExample: '6 - 12 September 2022' }),
                                    },
                                }),
                            },
                        },
                    }),
                    resolve: async (_, __, ___, info) => {
                        const fields = graphqlFields(info);
                        const idsToFetch = [
                            ...(fields.weekly
                                ? Object.keys(fields.weekly)
                                    .filter(notUpdated)
                                    .map(weeklyIds.fromName)
                                : []),
                            ...(fields.vax
                                ? Object.values(fields.vax).flatMap(Object.keys)
                                    .filter(notUpdated)
                                    .map(vaxIds.fromName)
                                : []),
                        ];
                        const [[weeklyUpdated, weeklyWeek], vaxPctsUpdated, vaxTotalsWeek, { weekly, vax },] = await Promise.all([
                            fields.weekly?.updated || fields.weekly?.week
                                ? fetchParagraph(WEEKLY_UPDATED_ID, 'weekly (data page) updated + week').then((text) => [
                                    fields.weekly?.updated
                                        ? parseDataPageDate(text)
                                        : undefined,
                                    fields.weekly?.week
                                        ? parseWeek(WEEKLY_WEEK_RE)(text)
                                        : undefined,
                                ])
                                : [],
                            fields.vax?.percentages?.updated
                                ? fetchParagraph(VAX_PCTS_UPDATED_ID, 'vaccination percentages (home page) updated').then(parseHomePageDate)
                                : undefined,
                            fields.vax?.totals?.week
                                ? fetchParagraph(VAX_TOTALS_WEEK_ID, 'vaccination totals (weekly vaccination page) week').then(parseWeek(VAX_TOTALS_WEEK_RE))
                                : undefined,
                            idsToFetch.length
                                ? covidAPI('paragraph/statistic_block', 'stats', {
                                    fields: {
                                        'paragraph--statistics_block': 'field_statistic_heading',
                                    },
                                    filter: {
                                        c: {
                                            path: 'id',
                                            operator: 'IN',
                                            value: idsToFetch,
                                        },
                                    },
                                }).then(data => {
                                    const acc = {};
                                    for (const { id, attributes: { field_statistic_heading: stat }, } of data) {
                                        let obj;
                                        let key = weeklyIds.fromId(id);
                                        if (key === undefined) {
                                            key = vaxIds.fromId(id);
                                            acc.vax ??= {};
                                            obj = key.startsWith('dose')
                                                ? (acc.vax.percentages ??= {})
                                                : (acc.vax.totals ??= {});
                                        }
                                        else
                                            obj = acc.weekly ??= {};
                                        obj[key] = stat.trim();
                                    }
                                    return acc;
                                })
                                : {},
                        ]);
                        return {
                            weekly: { ...weekly, updated: weeklyUpdated, week: weeklyWeek },
                            vax: {
                                percentages: { ...vax?.percentages, updated: vaxPctsUpdated },
                                totals: { ...vax?.totals, week: vaxTotalsWeek },
                            },
                        };
                    },
                },
            },
        }),
    }),
}).createHandler({ cors: { origin: '*' } });
