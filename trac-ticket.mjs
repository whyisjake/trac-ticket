#!/usr/bin/env node
/**
 * Read a core.trac.wordpress.org ticket from the command line.
 *
 * Trac sits behind a JavaScript proof-of-work challenge that 403s every plain
 * HTTP client, so this drives headless Chromium (Playwright) to pass it, then
 * scrapes the rendered ticket into plain text or JSON.
 *
 * Usage:
 *   node trac-ticket.mjs 66079            # text
 *   node trac-ticket.mjs 66079 --json     # JSON
 *   node trac-ticket.mjs https://meta.trac.wordpress.org/ticket/8202   # any *.trac.wordpress.org
 *
 * Setup: `npm install` then `npx playwright install chromium` (one-time browser
 * download). The challenge cookie is kept in ~/.cache/trac-ticket so repeat runs
 * are fast.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice( 2 );
const asJson = args.includes( '--json' );
const target = args.find( ( a ) => ! a.startsWith( '--' ) );
if ( ! target ) {
	console.error( 'Usage: trac-ticket.mjs <ticket number or URL> [--json]' );
	process.exit( 2 );
}
const id = ( target.match( /(\d+)\s*$/ ) || [] )[ 1 ];
const host = target.startsWith( 'http' ) ? new URL( target ).host : 'core.trac.wordpress.org';
const url = `https://${ host }/ticket/${ id }`;

let context;
try {
	context = await chromium.launchPersistentContext( join( homedir(), '.cache/trac-ticket' ), { headless: true } );
} catch ( e ) {
	if ( /Executable doesn't exist/.test( e.message ) ) {
		console.error( 'Chromium is not installed. Run: npx playwright install chromium' );
		process.exit( 1 );
	}
	throw e;
}
const page = context.pages()[ 0 ] || ( await context.newPage() );
await page.goto( url, { waitUntil: 'domcontentloaded' } );
try {
	await page.waitForSelector( '#ticket', { timeout: 60000 } );
} catch {
	console.error( `Ticket did not render. Page title: ${ await page.title() }` );
	await context.close();
	process.exit( 1 );
}

const data = await page.evaluate( () => {
	const text = ( el ) => ( el ? el.innerText.replace( /\u200b/g, '' ).replace( /\s+\n/g, '\n' ).trim() : '' );
	const q = ( sel, root = document ) => root.querySelector( sel );
	const qa = ( sel, root = document ) => Array.from( root.querySelectorAll( sel ) );

	const ticket = q( '#ticket' );
	const props = {};
	qa( 'table.properties th', ticket ).forEach( ( th ) => {
		const key = th.textContent.replace( /:\s*$/, '' ).trim();
		const td = th.nextElementSibling;
		if ( key && td ) props[ key ] = text( td );
	} );

	const attachments = qa( '#attachments dl.attachments dt' ).map( ( dt ) => {
		const a = q( 'a', dt );
		return {
			name: a ? a.textContent.trim() : text( dt ),
			url: a ? new URL( a.getAttribute( 'href' ), location.href ).href.replace( '/attachment/', '/raw-attachment/' ) : '',
			meta: text( dt ).replace( a ? a.textContent.trim() : '', '' ).trim(),
			description: text( dt.nextElementSibling && dt.nextElementSibling.tagName === 'DD' ? dt.nextElementSibling : null ),
		};
	} );

	const prs = qa( 'a[href*="github.com/"][href*="/pull/"]' )
		.map( ( a ) => a.href )
		.filter( ( v, i, arr ) => arr.indexOf( v ) === i );

	const comments = qa( '#changelog div.change' ).map( ( c ) => {
		const h = q( 'h3.change', c );
		const num = ( q( '.threading a[href^="#comment"]', c ) || q( 'a.tracid', h ) || {} ).textContent || ( ( text( h ).match( /comment:(\d+)/ ) || [] )[ 1 ] ? 'comment:' + text( h ).match( /comment:(\d+)/ )[ 1 ] : '' );
		return {
			id: ( num || '' ).trim(),
			author: text( q( '.trac-author, .trac-author-user, .trac-author-anonymous', h ) )
				|| ( ( h && h.classList.contains( 'chat-bot' ) && qa( '.username-line a', h ).pop() ) ? text( qa( '.username-line a', h ).pop() ) : '' )
				|| text( q( '.username-line a:not(:has(img))', h ) )
				|| ( h && h.classList.contains( 'chat-bot' ) ? '(bot)' : '' ),
			when: ( ( q( 'a.timeline', h ) || {} ).title || text( q( 'a.timeline', h ) ) ).replace( /^See timeline at\s*/, '' ),
			changes: qa( 'ul.changes li', c ).map( text ),
			text: text( q( 'div.comment', c ) ),
		};
	} );

	return {
		id: text( q( 'a.trac-id', ticket ) ),
		summary: ( document.title.match( /^#\d+\s+\((.*)\)\s+–/ ) || [ '', text( q( 'h1', ticket ) ) ] )[ 1 ],
		status: text( q( 'span.trac-status', ticket ) ),
		type: text( q( 'span.trac-type', ticket ) ),
		resolution: text( q( 'span.trac-resolution', ticket ) ),
		properties: props,
		description: text( q( '.description .searchable', ticket ) ),
		attachments,
		pull_requests: prs,
		comments,
		url: location.href.split( '#' )[ 0 ],
	};
} );

await context.close();

if ( asJson ) {
	console.log( JSON.stringify( data, null, 2 ) );
	process.exit( 0 );
}

const out = [];
out.push( `${ data.id } ${ data.summary }` );
out.push( `${ [ data.status, data.type, data.resolution ].filter( Boolean ).join( ' ' ) }  ${ data.url }` );
out.push( '' );
for ( const [ k, v ] of Object.entries( data.properties ) ) out.push( `${ k.padEnd( 12 ) } ${ v }` );
out.push( '', '== Description ==', '', data.description || '(none)' );
if ( data.attachments.length ) {
	out.push( '', '== Attachments ==', '' );
	for ( const a of data.attachments ) out.push( `- ${ a.name } ${ a.meta }${ a.description ? `\n    ${ a.description }` : '' }\n    ${ a.url }` );
}
if ( data.pull_requests.length ) {
	out.push( '', '== Pull Requests ==', '' );
	for ( const p of data.pull_requests ) out.push( `- ${ p }` );
}
out.push( '', `== Change History (${ data.comments.length }) ==` );
for ( const c of data.comments ) {
	out.push( '', `--- ${ c.id || '(change)' } ${ c.author } ${ c.when }`.trim() );
	for ( const ch of c.changes ) out.push( `  * ${ ch }` );
	if ( c.text ) out.push( '', c.text );
}
console.log( out.join( '\n' ) );
