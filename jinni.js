#!/opt/local/bin/node --abort-on-uncaught-exception

var fs = require('fs');
var path = require('path');
var process = require('process');

var irc = require('irc');
var https = require('https');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'jinni'});
var config = loadConfig();

// The holdout object will keep track of when the last time an issue was
// commented on, on a per-room basis, and to self.
var holdout = {};
config.channels.forEach(function (chan) {
    holdout[chan] = {};
});
holdout[config.nickname] = {};
var holdout_time = 180000; // ms

/* jsl:ignore */
/* JSSTYLED */
var bugview_re = new RegExp(/(https?:\/\/smartos.org\/bugview\/)?\b([A-Z]+-\d+)\b(.*)?/);
/* JSSTYLED */
var github_re = new RegExp(/\b([0-z\-_]+\b\/)?\b([0-z\-_]+)\b#\b([0-9]+)\b(.*)/);
var changelog_re = new RegExp('^' + config.nickname.toLowerCase()
    + ':? changelog');
/* jsl:end */

log.info({server: config.server,
    nickname: config.nickname,
    realname: config.realname,
    channels: config.channels }, 'Connecting...');

var client = new irc.Client(
    config.server, config.nickname,
    {
        userName: config.username,
        realName: config.realname,
        channels: config.channels
    }
);
log.info('Client initialized');

client.addListener('error', function (e) {
    log.error({error: e});
});

/* jsl:ignore */
client.addListener('message', function (from, to, message) {
    var matches;
    var reply_to = to;

    // If sent as a private message, respond with a private message.
    if (to == config.nickname) {
        reply_to = from;
    }

    if (matches = message.match(bugview_re)) {
        log.info({from: from, to: to, reply_to: reply_to, message: message,
            matches: matches}, 'Matched bugview issue');
        checkIssue(from, to, reply_to, message, matches);
        return (0);
    }

    if (matches = message.match(changelog_re)) {
        log.info({from: from, to: to, reply_to: reply_to, message: message,
            matches: matches}, 'Matched changelog');
        getChangelog(from, to, reply_to, message, matches);
        return (0);
    }

    if (matches = message.match(github_re)) {
        log.info({from: from, to: to, reply_to: reply_to, message: message,
            matches: matches}, 'Matched github issue');
        var gh_user = matches[1] || 'joyent/';
        getGhIssue(from, to, reply_to, message, gh_user,  matches[2],
            matches[3], matches[4]);
        return (0);
    }

    return (0);
});
/* jsl:end */

client.addListener('registered', function (message) {
    log.info({message: message}, 'Connected.');
});

client.addListener('motd', function (motd) {
    log.info({motd: motd});
});

client.addListener('names', function (channel) {
    log.info({channel: channel}, 'Joined channel');
});

var checkIssue = function (from, to, reply_to, message, matches) {

    var issue = matches[2];
    var i = holdout[to][issue] || {};
    var last_code  = i.code || 0;
    var last_time  = i.time || 0;
    var now = new Date();
    var addtl_text = matches[3] || '';
    var addtl_match = addtl_text.match(bugview_re) || [null, null, null];
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
                client.say(reply_to,
                    'https://smartos.org/bugview/' + matches[2]);
                break;
            case 403:
                client.say(reply_to, 'Sorry, ' + issue + ' is not public.');
                break;
            default:
                log.info({issue: issue, res: res}, 'No reply');
                break;
            }
            holdout[to][issue] = {time: now, code: res.statusCode};
        } else {
            /* JSSTYLED */
            log.info('Waiting an additional %d seconds before replying for %s in %s',
                (last_time - now + holdout_time) / 1000,
                    issue, to);
        }
    }).on('error', function (e) {
        log.error(e);
    });
    return (0);
};

var getChangelog = function (from, to, reply_to, message, matches) {
    log.info({from: from, to: to, message: message,
        matches: matches});

    /* JSSTYLED */
    client.say(reply_to, 'http://us-east.manta.joyent.com/Joyent_Dev/public/SmartOS/smartos.html');
};

var getGhIssue = function (from, to, reply_to, message, gh_user, gh_repo,
    gh_issue, addtl_text) {

    var gh_url = 'https://api.github.com/repos/' + gh_user + gh_repo
        + '/issues/' + gh_issue;
    var issue = gh_user + '/' + gh_repo + '#' + gh_issue;
    var i = holdout[to][issue] || {};
    var last_code = i.code || 0;
    var last_time = i.time || 0;
    var now = new Date();
    var addtl_match = addtl_text.match(github_re) || [null, null, null];
    var req_options = {
        hostname: 'api.github.com',
        path: '/repos/'  + gh_user + gh_repo + '/issues/' + gh_issue,
        headers: {
            'User-Agent': 'jinni/1.1.0'
        }
    };

    log.info({from: from, to: to, message: message, last_time: last_time,
        last_code: last_code, addtl_text: addtl_text, gh_url: gh_url},
        'Need to look up github issue.');

    // Look for any additional matches in the remainder of the text.
    if (addtl_match[2] !== null) {
        var addtl_gh_user = addtl_match[1] || 'joyent/';
        log.info({matches: addtl_match}, 'Looking up additional github issue');
        getGhIssue(from, to, addtl_text, addtl_gh_user, addtl_match[2],
            addtl_match[3], addtl_match[4]);
    }

    var req = https.get(req_options, function (res) {
        var comment;
        if (res.statusCode !== last_code || now - last_time > holdout_time) {
            switch (res.statusCode) {
                case 200:
                    client.say(reply_to, 'https://github.com/' + gh_user
                        + gh_repo + '/issues/' + gh_issue);
                    comment = 'Found issue';
                    break;
                default:
                    comment = 'Issue not found';
                    break;
            }
            holdout[to][issue] = {time: now, code: res.statusCode};
            log.info({res: res}, comment);
        } else {
            /* JSSTYLED */
            log.info('Waiting an additional %d seconds before replying for %s in %s',
                (last_time - now + holdout_time) / 1000,
                    issue, to);
        }
    }).on('error', function (e) {
        log.error(e);
    });
    log.info({req: req}, 'Sent request to github.');
    return (0);
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
