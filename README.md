# Imgur Secure

Secure commenting for Imgur galleries.

Image galleries are managed as groups with encrypted commenting between users.

## Features

* Add multiple Imgur accounts
* Create groups for posting comments
* Create encrypted comments
* View deciphered comments
* Add and remove users from group
* Stores group encryption keys and user access tokens in database

<img src="https://github.com/sengleung/imgur-sec/blob/master/img/imgur-sec-1.png" width="635">

<img src="https://github.com/sengleung/imgur-sec/blob/master/img/imgur-sec-2.png" width="635">

## Technologies

* [JavaScript](https://www.javascript.com/)
* [Node.js](https://nodejs.org/)
* [SQLite](https://www.sqlite.org/)
* [Imgur API](https://apidocs.imgur.com/)


## Deployment

### Run

```
$ node imgursec.js
```

### Dependencies

```
$ npm install sqlite3
```
```
$ npm install opn
```

## Console

```
$ username/group>
```

## Commands

### Users

`user` show all users

`user -s <username>` switch user

`user -a` add new user with authentication

`user -r <username>` remove user

### Groups

`group` show all groups for this user

`group -s "<group_name>"` switch groups

`group -c "<group_name>"` create new group with this user as admin

`group -m` show all members in group

`group -a <username>` add user to group (if current user is admin)

`group -r <username>` remove user from group (if current user is admin)

### Comments

`comment` show all comments for this group

`comment -c "<comment>"` create new comment on this group

### Misc.

`clear` clear screen

`quit` quit program
