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
var rfd_re = new RegExp(/[Rr][Ff][Dd][\s-]?(0*\d+)\b(.*)?/);
var changelog_re = new RegExp('^' + config.nickname.toLowerCase()
    + ':? changelog');
var illumos_re = new RegExp(/illumos#(\d+)(.*)?/);
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
        // Log messages from nickserv
        if (from === 'NickServ') {
            log.info({from: from, to: to, message: message},
            'Message from NickServ');
        }
    }

    if (matches = message.match(illumos_re)) {
        log.info({from: from, to: to, reply_to: reply_to, message: message,
            matches: matches}, 'Matched illumos');
        getIllumos(from, to, reply_to, message, matches);
    }

    if (matches = message.match(rfd_re)) {
        log.info({from: from, to: to, reply_to: reply_to, message: message,
            matches: matches}, 'Matched RFD');
        getRfd(from, to, reply_to, message, matches);
    }

    if (matches = message.match(bugview_re)) {
        log.info({from: from, to: to, reply_to: reply_to, message: message,
            matches: matches}, 'Matched bugview issue');
        checkBugView(from, to, reply_to, message, matches);
    }

    if (matches = message.match(changelog_re)) {
        log.info({from: from, to: to, reply_to: reply_to, message: message,
            matches: matches}, 'Matched changelog');
        getChangelog(from, to, reply_to, message, matches);
    }

    if (matches = message.match(github_re)) {
        if (matches[3] !== 'illumos') {
            log.info({from: from, to: to, reply_to: reply_to, message: message,
                matches: matches}, 'Matched github issue');
            var gh_user = matches[1] || 'TritonDataCenter/';
            getGhIssue(from, to, reply_to, message, gh_user,  matches[2],
                matches[3], matches[4]);
        }
    }

    log.debug({from: from, to: to, message: message}, 'Ignored message');

    return (0);
});
/* jsl:end */

client.addListener('registered', function (message) {
    log.info({message: message}, 'Connected.');
    verifyNick();
    joinChannels(config.channels);
});

client.addListener('motd', function (motd) {
    log.info({motd: motd});
});

client.addListener('names', function (channel) {
    log.info({channel: channel}, 'Joined channel');
});

var verifyNick = function () {
    if (client.nick != config.nickname) {
        log.warn({nick: client.nick, wanted: config.nickname}, 'Got a ghost.');
        log.info({nick: client.nick}, 'Attempting nick recovery');
        client.say('nickserv', [
            'ghost',
            config.nickname,
            config.nickserv_password
        ].join(' '));
        log.info({nick: client.nick}, 'Ghost recovery sent');
        setTimeout(function () {
            log.info('Changing nick to ' + config.nickname);
            client.send('NICK', config.nickname);
            verifyNick();
        }, 1000);
    } else {
        log.info({nick: client.nick}, 'I got the nick I wanted.');
        log.info('Authenticating as ' + client.nick);
        client.say('nickserv', 'identify ' + config.nickserv_password);
        log.info({nick: client.nick}, 'nick is now ' + client.nick);
        return (0);
    }
};

var joinChannels = function (c) {
    log.info('joining channels');
    c.forEach(function (chan) {
        log.info('join channel ' + chan);
        client.join(chan, function (j) {
            log.info({channel: j}, 'Joined channel ' + j);
        });
     });
    return (0);
};

var checkBugView = function (from, to, reply_to, message, matches) {

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
        checkBugView(from, to, reply_to, addtl_text, addtl_match);
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
    client.say(reply_to, 'http://us-east.manta.mnx.io/Joyent_Dev/public/SmartOS/smartos.html');
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
    if (addtl_match[2] !== null && addtl_match[2] !== 'illumos') {
        var addtl_gh_user = addtl_match[1] || 'TritonDataCenter/';
        log.info({matches: addtl_match}, 'Looking up additional github issue');
        getGhIssue(from, to, reply_to, addtl_text, addtl_gh_user, addtl_match[2],
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

var getRfd = function (from, to, reply_to, message, matches) {

    var rfd = matches[1].lpad(4, '0');
    var i = holdout[to][rfd] || {};
    var last_code  = i.code || 0;
    var last_time  = i.time || 0;
    var now = new Date();
    var addtl_text = matches[2] || '';
    var addtl_match = addtl_text.match(rfd_re) || [null, null, null];

    log.info({from: from, to: to, message: message,
        last_time: last_time, last_code: last_code,
        matches: matches}, 'Need to look up RFD');

    // Look for any additional matches in the remainder of the text.
    if (addtl_match[1] !== null) {
        log.info({matches: addtl_match}, 'Looking up additional matches');
        getRfd(from, to, reply_to, addtl_text, addtl_match);
    }

    log.info('Check URL https://github.org/TritonDataCenter/rfd/tree/master/rfd/' + rfd);
    https.get('https://github.com/TritonDataCenter/rfd/tree/master/rfd/' + rfd,
        function (res) {
            log.info({rfd: rfd, statusCode: res.statusCode});
            if (res.statusCode !== last_code ||
                    now - last_time > holdout_time) {

                switch (res.statusCode) {
                case 200:
                    client.say(reply_to,
                        'https://github.com/TritonDataCenter/rfd/tree/master/rfd/' + rfd);
                    break;
                default:
                    log.info({rfd: rfd, res: res}, 'No reply');
                    break;
                }
                holdout[to][rfd] = {time: now, code: res.statusCode};
            } else {
                /* JSSTYLED */
                log.info('Waiting an additional %d seconds before replying for %s in %s',
                    (last_time - now + holdout_time) / 1000,
                        rfd, to);
            }
        }).on('error', function (e) {
        log.error(e);
    });
    return (0);
};

var getIllumos = function (from, to, reply_to, message, matches) {

    var issue = matches[1];
    var holdout_key = 'illumos_' + issue;
    var i = holdout[to][holdout_key] || {};
    var last_code  = i.code || 0;
    var last_time  = i.time || 0;
    var now = new Date();
    var addtl_text = matches[2] || '';
    var addtl_match = addtl_text.match(illumos_re) || [null, null, null];
    var base_url = 'https://www.illumos.org/issues/';
    var issue_url = base_url + issue;

    log.info({from: from, to: to, message: message,
        last_time: last_time, last_code: last_code,
        matches: matches}, 'Need to look up illumos issue');

    // Look for any additional matches in the remainder of the text.
    if (addtl_match[1] !== null) {
        log.info({matches: addtl_match}, 'Looking up additional matches');
        getIllumos(from, to, reply_to, addtl_text, addtl_match);
    }

    log.info('Check URL ' + issue_url);
    https.get(issue_url, function (res) {
            log.info({issue: issue, statusCode: res.statusCode});
            if (res.statusCode !== last_code ||
                    now - last_time > holdout_time) {
                switch (res.statusCode) {
                case 200:
                    client.say(reply_to, issue_url);
                    break;
                default:
                    log.info({issue: issue, res: res}, 'No reply');
                    break;
                }
                holdout[to][holdout_key] = {time: now, code: res.statusCode};
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

// Extend String object so we can pad it for RFD lookups.
String.prototype.lpad = function (size, character) {
    var s = this;
    while (s.length < (size || 2)) { s = character + s; }
    return (s);
};
