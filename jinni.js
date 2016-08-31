#!/usr/bin/env node --abort-on-uncaught-exception

var fs = require('fs');
var path = require('path');
var process = require('process');

var irc = require('irc');
var https = require('https');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'jinni'});
var config = loadConfig();

// The holdout object will keep track of when the last time an issue was
// commented on, on a per-room basis.
var holdout = {};
config.channels.forEach(function (chan) {
    holdout[chan] = {};
});
var holdout_time = 180000; // ms

/* jsl:ignore */
/* JSSTYLED */
var issue_re = new RegExp(/(https?:\/\/smartos.org\/bugview\/)?\b([A-Z]+-\d+)\b(.*)?/);
var changelog_re = new RegExp('^' + config.nickname.toLowerCase()
    + ':? changelog');
/* jsl:end */

log.info({server: config.server,
    nickname: config.nickname,
    realname: config.realname,
    channels: config.channels }, "Connecting...");
var client = new irc.Client(
    config.server, config.nickname,
    {
        userName: config.username,
        realName: config.realname,
        channels: config.channels
    }
);
log.info("Client initialized");

client.addListener('error', function (e) {
    log.error({error: e});
});

/* jsl:ignore */
client.addListener('message', function (from, to, message) {
    var matches;

    if (matches = message.match(issue_re)) {
        checkIssue(from, to, message, matches);
        return (0);
    }

    if (matches = message.match(changelog_re)) {
        getChangelog(from, to, message, matches);
        return (0);
    }
    return (0);
});
/* jsl:end */

client.addListener('motd', function (motd) {
    log.info({motd: motd});
});

var checkIssue = function (from, to, message, matches) {

    var issue = matches[2];
    var i = holdout[to][issue] || {};
    var last_code  = i.code || 0;
    var last_time  = i.time || 0;
    var now = new Date();
    var addtl_text = matches[3] || '';
    var addtl_match = addtl_text.match(issue_re) || [null, null, null];
    var url = matches[1] || '';

    log.info({from: from, to: to, message: message,
        last_time: last_time, last_code: last_code,
        matches: matches}, 'Need to look up a ticket');

    // Look for any additional matches in the remainder of the text.
    if (addtl_match[1] !== null) {
        log.info({matches: addtl_match}, 'Looking up additional matches');
        checkIssue(from, to, addtl_text, addtl_match);
    }

    // If this matches the bugview URL, skip it.
    if (url.match(/^http/)) {
        log.info({matches: matches[1]}, 'Looks like a pasted URL, ignoring.');
        return (0);
    }

    log.info('Check URL https://smartos.org/bugview/' + issue);
    https.get('https://smartos.org/bugview/' + issue, function (res) {
        log.info({issue: issue, statusCode: res.statusCode});
        if (res.statusCode !== last_code ||
                now - last_time > holdout_time) {

            switch (res.statusCode) {
            case 200:
                client.say(to,
                'https://smartos.org/bugview/' + matches[2]);
                break;
            case 403:
                client.say(to, 'Sorry, '
                + issue + ' is not public.');
                break;
            default:
                log.info({issue: issue, res: res}, 'No reply');
                break;
            }
            holdout[to][issue] = {time: now, code: res.statusCode};
        } else {
            /* JSSTYLED */
            log.info('Waiting an additional %d  seconds before replying for %s in %s',
                (last_time - now + holdout_time) / 1000,
                    issue, to);
        }
    }).on('error', function (e) {
        log.error(e);
    });
    return (0);
};

var getChangelog =  function (from, to, message, matches) {
    log.info({from: from, to: to, message: message,
        matches: matches});

    /* JSSTYLED */
    client.say(to, 'http://us-east.manta.joyent.com/Joyent_Dev/public/SmartOS/smartos.html');
};

/* jsl:ignore */
function loadConfig() {
    var configPath = path.join(__dirname, 'config.json');

    if (!fs.existsSync(configPath)) {
        log.error('Config file not found: ' + configPath +
            ' does not exist. Aborting.');
        process.exit(1);
    }

    var theConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    log.debug('Configuration loaded');
    return (theConfig);
}
/* jsl:end */
