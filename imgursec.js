/**
 * imgursec.js
 * Imgur Secure
 *
 * @author sengleung
 */

// Libraries -----------------------------------------------------------------------------------------------------------

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const querystring = require('querystring');
const readline = require('readline');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const opn = require('opn');

// Constants -----------------------------------------------------------------------------------------------------------

const CLIENT_ID = '26556b45a2eb39b';
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const IMAGE_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const DATABASE_FILE = './db';
const HOSTNAME = '127.0.0.1';
const PORT = 10000;

// Encryption Block Structure ------------------------------------------------------------------------------------------

const BLOCK_ID_SIZE = 6;
const BLOCK_M_SIZE = 3;
const BLOCK_N_SIZE = 3;
const BLOCK_PAYLOAD_SIZE = 48;

const BLOCK_ID_INDEX = BLOCK_ID_SIZE;
const BLOCK_M_INDEX = BLOCK_ID_INDEX + BLOCK_M_SIZE;
const BLOCK_N_INDEX = BLOCK_M_INDEX + BLOCK_N_SIZE;
const BLOCK_PAYLOAD_INDEX = BLOCK_N_INDEX + BLOCK_PAYLOAD_SIZE;

// Globals -------------------------------------------------------------------------------------------------------------

var db;
var server;
var rl;
var log;

var currentUser = '';
var currentAccessToken = '';
var currentGroupId = '';
var currentGroupName = '';

// Encryption ----------------------------------------------------------------------------------------------------------

// generate random string of size n
function createRandStr(n) {
    var text = "";
    for (var i = 0; i < n; i++) {
        text += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    }
    return text;
}

// encrypt string with password
function encrypt(text, password) {
    var cipher = crypto.createCipher(ENCRYPTION_ALGORITHM, password);
    var crypted = cipher.update(text, 'utf8', 'hex');
    crypted += cipher.final('hex');
    return crypted;
}

// decrypt string with password
function decrypt(text, password) {
    var decipher = crypto.createDecipher(ENCRYPTION_ALGORITHM, password);
    var dec = decipher.update(text, 'hex', 'utf8');
    try {
        dec += decipher.final('utf8');
        return dec;
    } catch (ex) {
        return;
    }
}

// Block Encryption ----------------------------------------------------------------------------------------------------

// encrypt text into encrypted blocks with id and sequence info
// max size of block is 128 characters
function encryptToBlocks(text, password) {
    var textBlocks = [];
    for (var i = 0; i < text.length; i += BLOCK_PAYLOAD_SIZE) {
        textBlocks.push(text.substring(i, (i + BLOCK_PAYLOAD_SIZE < text.length ?
            i + BLOCK_PAYLOAD_SIZE : text.length)));
    }
    var blocks = [];
    var id = createRandStr(BLOCK_ID_SIZE);
    var size = (textBlocks.length - 1);
    for (var i = 0; i < textBlocks.length; i++) {
        var block = id;
        block += ("000" + i).slice(-BLOCK_M_SIZE);
        block += ("000" + size).slice(-BLOCK_N_SIZE);
        block += textBlocks[i];
        blocks.push(encrypt(block, password));
    }
    return blocks;
}

// decrypt comments from Imgur gallery comments JSON
function decryptComments(d, password) {
    // decrypt each ciphered block if possible
    var commentBlocks = {};
    d.data.forEach(function(e) {
        var block = decrypt(e.comment, password);
        if (block != undefined) {
            var id = block.substring(0, BLOCK_ID_INDEX);
            var m = parseInt(block.substring(BLOCK_ID_INDEX, BLOCK_M_INDEX));
            var payload = block.substring(BLOCK_N_INDEX, BLOCK_PAYLOAD_INDEX);
            if (!(id in commentBlocks)) {
                var n = parseInt(block.substring(BLOCK_M_INDEX, BLOCK_N_INDEX));
                commentBlocks[id] = new Array(n);
            }
            commentBlocks[id][m] = payload;
        }
    });

    // concatenate payloads to form decrypted text
    var comments = {};
    for (var id in commentBlocks) {
        var arr = commentBlocks[id];
        comments[id] = arr.join('');
    }

    // format and print decrypted comments
    console.log("[comments]");
    for (var i = d.data.length - 1; i >= 0; --i) {
        var e = d.data[i];
        var time = (new Date(e.datetime * 1000)).toString().substring(0, 24);
        var author = e.author;
        var block = decrypt(e.comment, password);
        if (block != undefined) {
            var id = block.substring(0, BLOCK_ID_INDEX);
            if (id in comments) {
                console.log("[" + time + "] " + author + ": " + comments[id]);
                delete comments[id];
            }
        } else {
            console.log("[" + time + "] " + author + ": " + "** ENCRYPTED **");
        }
    }
}

// Imgur API Endpoints -------------------------------------------------------------------------------------------------

function getHostname() {
    return 'api.imgur.com';
}

function getAuthHeader(accessToken) {
    return `Bearer ${accessToken}`;
}

function getCommentCreationPath(galleryId, comment) {
    return `/3/gallery/${galleryId}/comment?comment=${comment}`;
}

function getCommentPath(galleryId) {
    return `/3/gallery/${galleryId}/comments/new?client_id=${CLIENT_ID}`;
}

function getShareGalleryPath(imageId, imageTitle) {
    return `/3/gallery/image/${imageId}?title=${imageTitle}&?mature=1`;
}

function getUploadImagePath() {
    return `/3/image`;
}

function getUploadImageContentType() {
    return 'application/x-www-form-urlencoded';
}

function getAuthenticationUrl() {
    return `https\://api.imgur.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=token`;
}

// Imgur API -----------------------------------------------------------------------------------------------------------

// encrypt comment post
function encryptComment(accessToken, galleryId, password, comment) {
    var encryptedBlocks = encryptToBlocks(comment, password);
    encryptedBlocks.forEach(function(e) {
         postComment(accessToken, galleryId, e);
    });
}

// post comment to Imgur gallery
function postComment(accessToken, galleryId, comment) {
    var options = {
        hostname: getHostname(),
        port: 443,
        path: getCommentCreationPath(galleryId, comment),
        method: 'POST',
        headers: {
            'Authorization': getAuthHeader(accessToken),
        }
    };
    var req = https.request(options, (res) => {
        res.on('data', (d) => {
            if (res.statusCode != 200) {
                process.stdout.write(d);
            }
        });
    });
    req.on('error', (e) => {
        console.error(e);
    });
    req.end();
}

// get Imgur comments from gallery in JSON
function getComments(accessToken, galleryId, password) {
    var options = {
        hostname: getHostname(),
        port: 443,
        path: getCommentPath(galleryId),
        method: 'GET',
        headers: {
            'Authorization': getAuthHeader(accessToken),
        }
    };
    var str = '';
    callback = function(response) {
        response.on('data', function(chunk) {
            str += chunk;
        });
        response.on('end', function() {
            var d = JSON.parse(str);
            decryptComments(d, password);
        });
    }
    var req = https.request(options, callback).end();
}

// share image to publicly accessible gallery for comment posting
function shareGallery(accessToken, imageId, groupName) {
    var options = {
        hostname: getHostname(),
        port: 443,
        path: getShareGalleryPath(imageId, createRandStr(32)),
        method: 'POST',
        headers: {
            'Authorization': getAuthHeader(accessToken),
        }
    };
    var req = https.request(options, (res) => {
        res.on('data', (d) => {
            if (res.statusCode != 200) {
                process.stdout.write(d);
            }
        });
        res.on('end', function() {
            if (res.statusCode === 200) {
                addGroup(imageId, groupName, currentUser, createRandStr(32));
            }
        });
    });
    req.end();
}

// upload dummy image to Imgur to create a comment posting space
function createGroup(accessToken, groupName) {
    var postData = querystring.stringify({
        'image': IMAGE_BASE64,
        'type': 'base64'
    });
    var options = {
        hostname: getHostname(),
        port: 443,
        path: getUploadImagePath(),
        method: 'POST',
        headers: {
            'Authorization': getAuthHeader(accessToken),
            'Content-Type': getUploadImageContentType(),
        }
    };
    var str = '';
    var req = https.request(options, (res) => {
        res.on('data', (d) => {
            if (res.statusCode != 200) {
                process.stdout.write(d);
            }
            if (res.statusCode === 200) {
                str += d;
            }
        });
        res.on('end', function() {
            if (res.statusCode === 200) {
                var d = JSON.parse(str);
                var imageId = d.data['id'];
                shareGallery(accessToken, imageId, groupName);
            }
        });
    });
    req.on('error', (e) => {
        console.error(e);
    });
    req.write(postData);
    req.end();
}

function parseQueryString(queryString) {
    var params = {};
    var regex = /([^&=]+)=([^&]*)/g;
    var m;
    while (m = regex.exec(queryString)) {
        params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
    }
    return params;
}

// opens web browser to authenticate Imgur account and add to database
function authenticateAccount() {
    if (server === undefined) {
        // server receives account access token
        server = http.createServer();
        server.on('request', (req, res) => {
            if (req.url.substring(1, 11) == 'catchtoken') {
                var user = parseQueryString(req.url.split('?')[1]);
                addUser(user['account_username'], user['access_token']);
                server.close();
            } else {
                res.end('<html><head><title>Authorisation Successful</title></head><body>' +
                    '<h1>Authorisation Successful</h1><p>You can close this window</p>' +
                    '<script>for(var m,params={},queryString=location.hash.substring(1),regex=/([^&=]+)=([^&]*)/g;' +
                    'm=regex.exec(queryString);)params[decodeURIComponent(m[1])]=decodeURIComponent(m[2]);' +
                    'var req=new XMLHttpRequest;req.open("GET","http://"+window.location.host+"/catchtoken?"' +
                    '+queryString,!0),req.onreadystatechange=function(e){4==req.readyState&&200==req.status&&' +
                    '(window.location=params.state)},req.send(null);</script></body></html>');
            }
        });
        server.listen(PORT, HOSTNAME);
    }
    opn('--app=' + getAuthenticationUrl(), {app: ['chrome', '--incognito']});
}

// Database ------------------------------------------------------------------------------------------------------------

function showUsers() {
    db.serialize(function() {
        console.log("[users]");
        db.each("SELECT username FROM Users", function(err, rows) {
            console.log(rows['username']);
        });
    });
}

function switchUser(username) {
    db.serialize(function() {
        db.each("SELECT * FROM Users WHERE username = ?", username, function(err, rows) {
            currentUser = rows['username'];
            currentAccessToken = rows['access_token'];
            setPrompt(currentUser, currentGroupName);
        });
    });
}

function addUser(userName, accessToken) {
    db.serialize(function() {
        db.run("INSERT INTO Users VALUES (?, ?)", [userName, accessToken]);
    });
}

function removeUser(username) {
    db.serialize(() => {
        db.each("DELETE FROM Members WHERE group_id IN (SELECT group_id FROM Groups WHERE admin = ?)", 
            username, function(err) {
            if (err) {
                return console.error(err.message);
            }
        }, () => {
            db.each("DELETE FROM Groups WHERE admin = ?", username, function(err) {
                if (err) {
                    return console.error(err.message);
                }
            }, () => {
                db.each("DELETE FROM Users WHERE username = ?", username, function(err) {
                    if (err) {
                        return console.error(err.message);
                    }
                });
            });
        });
    });
}

function showGroups(username) {
    console.log("[groups]");
    db.serialize(function() {
        db.each("SELECT name FROM Groups WHERE admin = ?", username, function(err, rows) {
            console.log(rows['name']);
        });
    });
}

function switchGroups(groupName, username) {
    db.serialize(function() {
        db.each("SELECT group_id FROM Groups WHERE name = ? AND group_id IN (SELECT group_id FROM Members " + 
            "WHERE username = ?);", [groupName, username], function(err, rows) {
            if (rows != undefined) {
                currentGroupId = rows['group_id'];
                currentGroupName = groupName;
                setPrompt(currentUser, groupName);
            }
        });
    });
}

function addGroup(groupId, groupName, admin, password) {
    db.serialize(function() {
        db.run("INSERT INTO Groups VALUES (?, ?, ?, ?)", [groupId, groupName, admin, password]);
        db.run("INSERT INTO Members VALUES (?, ?)", [groupId, admin]);
    });
}

function showMembers(groupId) {
    console.log("[members]");
    db.serialize(function() {
        db.each("SELECT username FROM Members WHERE group_id = ?", 
            groupId, function(err, rows) {
            console.log(rows['username']);
        });
    });
}

function addMember(groupId, username, admin) {
    db.serialize(() => {
        var id;
        db.each("SELECT group_id FROM Groups WHERE admin = ? AND group_id = ?", [admin, groupId], function(err, rows) {
            id = rows['group_id'];
        }, () => {
            if (id != undefined) {
                db.run("INSERT INTO Members VALUES (?, ?)", [groupId, username]);
            }
        });
    });
}

function removeMember(groupId, username, admin) {
    db.serialize(() => {
        var id;
        db.each("SELECT group_id FROM Groups WHERE admin = ? AND group_id = ?", [admin, groupId], function(err, rows) {
            id = rows['group_id'];
        }, () => {
            if (id != undefined) {
                db.run("DELETE FROM Members WHERE group_id = ? AND username = ?", [groupId, username]);
            }
        });
    });
}

function showComments(accessToken, groupId, username) {
    db.serialize(function() {
        db.each("SELECT password FROM Groups WHERE group_id IN (SELECT group_id FROM Members " + 
            "WHERE group_id = ? AND username = ?)", [groupId, username], function(err, rows) {
            if (rows != undefined) {
                getComments(accessToken, groupId, rows['password']);
            }
        });
    });
}

function createComment(accessToken, groupId, username, comment) {
    db.serialize(function() {
        db.each("SELECT password FROM Groups WHERE group_id IN (SELECT group_id FROM Members " + 
            "WHERE group_id = ? AND username = ?)", [groupId, username], function(err, rows) {
            if (rows != undefined) {
                encryptComment(accessToken, groupId, rows['password'], comment);
            }
        });
    });
}

function initDatabase() {
    var dbExists = fs.existsSync(DATABASE_FILE);
    if (dbExists) {
        db = new sqlite3.Database(DATABASE_FILE, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error(err.message);
            } else {
                db.run("PRAGMA foreign_keys = ON");
            }
        });
    } else {
        db = new sqlite3.Database(DATABASE_FILE);
        db.serialize(function() {
            db.run("CREATE TABLE Users (username VARCHAR(63) NOT NULL, access_token VARCHAR(40) NOT NULL, " +
                "PRIMARY KEY (username))");
            db.run("CREATE TABLE Groups (group_id VARCHAR(7) NOT NULL, name VARCHAR(63) NOT NULL, " + 
                "admin VARCHAR(63) NOT NULL, password VARCHAR(64) NOT NULL, PRIMARY KEY (group_id), " + 
                "FOREIGN KEY (admin) REFERENCES Users(username))");
            db.run("CREATE TABLE Members (group_id VARCHAR(7) NOT NULL, username VARCHAR(63) NOT NULL, " + 
                "PRIMARY KEY (group_id, username), FOREIGN KEY (group_id) REFERENCES Groups(group_id), " + 
                "FOREIGN KEY (username) REFERENCES Users(username))");
        });
    }
}

// Console -------------------------------------------------------------------------------------------------------------

// set console prompt username and group name
function setPrompt(username, groupName) {
    rl.setPrompt(`${username}/${groupName}> `);
    rl.prompt();
}

// parses argument text within quotation marks
function parseTextArg(args) {
    var text = args.slice(2, args.length).join(' ');
    text = text.substring(1, text.length - 1);
    return text;
}

// initialise console
function initConsole() {
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.setPrompt(`${currentUser}/${currentGroupName}> `);

    rl.on('line', function(input) {
        var args = input.split(' ');
        switch (args[0]) {
            case "user":
                if (args.length >= 2) {
                    switch (args[1]) {
                        case "-s":
                            if (args.length >= 3) {
                                switchUser(args[2]);
                            }
                            break;
                        case "-a":
                            authenticateAccount();
                            break;
                        case "-r":
                            if (args.length >= 3) {
                                removeUser(args[2]);
                            }
                            break;
                        default:
                            break;
                    }
                } else {
                    showUsers();
                }
                break;
            case "group":
                if (args.length >= 2) {
                    switch (args[1]) {
                        case "-s":
                            if (args.length >= 3) {
                                switchGroups(parseTextArg(args), currentUser);
                            }
                            break;
                        case "-c":
                            if (args.length >= 3) {
                                createGroup(currentAccessToken, parseTextArg(args));
                            }
                            setTimeout(function() {
                                showGroups(currentUser);
                            }, 5000);
                            break;
                        case "-m":
                            if (args.length >= 2) {
                                showMembers(currentGroupId);
                            }
                            break;
                        case "-a":
                            if (args.length >= 3) {
                                addMember(currentGroupId, args[2], currentUser);
                            }
                            break;
                        case "-r":
                            if (args.length >= 3) {
                                removeMember(currentGroupId, args[2], currentUser);
                            }
                            break;
                        default:
                            break;
                    }
                } else {
                    showGroups(currentUser);
                }
                break;
            case "comment":
                if (args.length >= 3) {
                    switch (args[1]) {
                        case "-c":
                            createComment(currentAccessToken, currentGroupId, currentUser, parseTextArg(args));
                            setTimeout(function() {
                                showComments(currentAccessToken, currentGroupId, currentUser);
                            }, 2000);
                        default:
                            break;
                    }
                } else {
                    showComments(currentAccessToken, currentGroupId, currentUser);
                }
                break;
            case "clear":
                console.clear();
                break;
            case "quit":
                process.exit(1);
                break;
            default:
                console.log("unknown command");
                break;
        }
        rl._refreshLine();
    });
    rl.prompt();

    log = console.log;
    console.log = function() {
        rl.output.write('\x1b[2K\r');
        log.apply(console, Array.prototype.slice.call(arguments));
        rl._refreshLine();
    }
}

// Main ----------------------------------------------------------------------------------------------------------------

initDatabase();
initConsole();
