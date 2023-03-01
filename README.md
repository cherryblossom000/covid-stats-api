# vic-covid-stats-api

A GraphQL API for COVID-19 stats in Victoria, Australia.

## Why?

This was created for my own personal use, so that I can do things like this with
[Plash](https://sindresorhus.com/plash):

![Screenshot of a macOS desktop, with COVID-19 statistics are overlaid on top of the desktop wallpaper](./covid-stats-desktop.png)

## Random notes for myself

Stuff in `notes/nuxt` is obtained by going to the relevant site:

- `data.json`: <https://www.coronavirus.vic.gov.au/victorian-coronavirus-covid-19-data>
- `weekly-vax.json`: <https://www.coronavirus.vic.gov.au/weekly-covid-19-vaccine-data>
- `deaths.json`: <https://www.coronavirus.vic.gov.au/additional-covid-19-case-data>

and then running this in the browser console:

```js
console.log(JSON.stringify(__NUXT__, null, '\t'))
```

Click the ‘Copy’ button and paste it in the file.

For `notes/{statistic_block,statistics_grid}.json`:

```elv
use math
peach {|x|
	fn fetch {|i| xhs -I content.vic.gov.au/api/v1/paragraph/$x Accept:application/vnd.api_json 'page[offset]=='$i | from-json }
	var p1 = (fetch 0)
	to-json [[(all $p1[data]) (range (math:ceil (/ $p1[meta][count] 50)) | each {|i| all (fetch (* (+ $i 1) 50))[data] })]] > notes/$x.json
} [statistic_block statistics_grid]
```

## License

[MIT](LICENSE)
