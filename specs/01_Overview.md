# Overview

Hacker House - Race-proof team formation at scale

We are building a production grade app named "Hacker House" which is a product for organizing hackathons. The admin can add new hackathons here, users can add teams inside a hackathon and invite members.

Each hackathon has a max team size limit which is assigned to every team for that hackathon. A team can't have more members than the hackathon's max_size limit whose the team is a part of.


These are the rules for the any hackathon/team which is part of the product:

1. A team cannot have more than max_size team size limit which is associated with the hackathon of which the team is the part of.
2. No user can be a part of two hackathons or two teams at the same time.
3. There is only one leader per team to approve/reject the join request of particpants which want to join the team.
5. When a team is created, it has an option for whether to allow only approved participants or any one can join the team, until there is a seat.
6. The team leader occupies a seat, so whenever a team is created, it has the team leader as its first member.
7. There is no expiry time for requests. A user can send the join requests to multiple teams. As a user joins a team (either as a member or a team leader when he creates his own team), all the pending requests sent from the user get cancelled / cascade delete.


The main purpose of the app is to solve the race condition problem encountered by the hackathon memberships.

## Important

There are two types of team joins or memberships which can occur based on the team. The team when created is asked for whether to allow approved participants only or any one can join the team.

If the team only allows approved participants, the participant has to request the team to join, the team leader approves or rejects the join request.

If the team allows anyone to join, then participants can join by themselves as soon as they click join and a seat is there.

Generally the race condition occur in these cases in such kind of products:

1. If team only allows approved participants (request-based):
- Multiple teams approve the same user at the same time.
- A team captain approves multiple users at the same time while the team has only last slot left.
- A user creates a team and another team accepts his pending request to join at the same time.

2. If team allows anyone to join (user joins as soon as they click Join Team button):
- Multiple participants click join at the same time, and only the last seat is left.
- A user clicks join on two different teams which allows participants to join without request.

3. Also, race conditions can occur in mix of both of the scenarios:
- There are two teams Team A and Team B. Team A requires approval from leader or captain, and Team B allows participants to join, without any approval. User sends request to Team A first. User then decides to join Team B, as soon as the user clicks "Join Team" for Team B, at the same time his join request at Team A gets accepted.
We have a race again here.

# Transactions

To solve the race conditions, one classic approach that we will start with is locking the data rows while operating on them via a transaction. Since a transaction holds the lock for the row, no other transaction can operate on it at the same time.

There are two scarce resources or points of contention in our product:

1. User: When two teams approve the same user at the same time.
2. Seat/Slot: When the captain approves multiple users at the same time.

We need to lock the data rows operating on the resource by the transaction. Also, apply constraints to have an extra layer of security so that the rules stay intact even if our transaction misses something.

Also, the lock needs to be applied on both the resources (user + seat), rather than any one of them and then relying on the consistent order of transaction.

This is because, suppose if we apply a lock on just the user row. Now two teams approving same user at same time, one of them gets blocked, sounds fine but, it doesn't handles the other case. Captain approving two users for the last seat at the same time, both still pass since there is no lock on the team row.

And if we lock just the team and not the user, then the first case will fail.

Hence, we need to lock both user + team rows while we perform the transaction.

The operations on transaction order still matters but to avoid deadlock and for the product rules, not to rely the whole locking onto it.


## Underlying Principle remains same

However, team joins could happen in two ways:
- User has to request first
- User can directly join

and race could happen in both these cases or even in a mix of them. But, the underlying principle to avoid the race has to be the same.

Lock the data rows before operating on them and then perform the DB operation. Keep the txn in a consistent order to avoid deadlock.

## Cancelling user requests as he joins a team

We can design our schema in such a way that as a user joins a team, we can cascade delete all his other pending requests.


Now there are two ways to do it:

> Perform the cascade in the same txn of joining the user, then the order of the txn operations matter. We would have to hold the user's lock first before approving the request, so that another txn just can't approve another team request and hold the team row lock and wait for the user's lock to be released, this would cause a deadlock cycle.

> Perform the cancellation as part of request clean up cycle that either runs via schedulers or outside the txn.


I have no fixed approach till now, and open to conversation which way is better among them or any new idea could be better for the task.


## Invite Codes

We have to bring invite codes into the play too. Invite codes are required for all the teams and each team has a unique invite code.

Teams which still have positions left are listed in "Looking for Teammates" board in the "All Teams" Page.

All the team info is publically available except the invite code of the team.

Only those users which have the invite code can join the team (if the team does not requires any approval), or request to join (if the teams requires an approval to join).


> In both the cases, the user must have the Invite code to join the team, then whether to join the user immediately or send a request to join user depends on the team policy.

## Idempotant Requests and other requirements

Idempotent: a retried request (double click, flaky network) never joins twice or creates two teams, and a live "looking for teammates" board. It must stay correct when hundreds of people click at the same moment.

We need teams with invite codes, join requests the leader accepts or declines, and a live "looking for teammates" board.


These are the must have points:
- Rules: team size between a minimum and a maximum, one team per person per hackathon, invite codes that expire, leadership passes on when the leader leaves, the last member leaving deletes the team
- Race-proof: 50 people try to take the last seat in a team at the same instant and exactly one gets it. Prove it with an automated concurrency test
- Idempotent: a retried request (double click, flaky network) never joins twice or creates two teams
- Real-time: the board and team pages update live for everyone (WebSockets or server-sent events), no refresh
- Secure: authentication, only the leader can accept, decline or remove; invite codes cannot be brute-forced (rate limits, enough entropy); every input validated
- An audit log of every team change: who, what, when
- Teammate suggestions: an endpoint that ranks people by complementary skills and time zone, with the scoring explained


To resolve idempotency, we will use an idempotency key header with our requests so the retries carry the header and the server can identify whether the same request has arrived earlier or not.


We must need to store the idempotent keys in a redis cache server and on our database also, so that we can have a permanent storage of them in case the redis server fails or any network error occurs.

Since requests can fail after all the processing is done (response lost midway). Retries can occur even if the request was processed successfully in the first time itself, therefore along with the idempotent keys we need to store the response if the request is processed successfully. We can return the same response for retry instead of re-processing everything.

A very hard case for failure is if request was failed mid-processing. But since, in such a product, our database owns everything and we do need to call any third party service or API which we can't undo, we can wrap the request handler or controller in a database transaction, so either we execute everything or we can easily rollback in case any failure occurs. So we are not stuck midway and never hit this hard failure case of partial execution / partial processing of request.


## Testing:

Tested and fast: at least 20 API tests, including the race test, running in CI (GitHub Actions). A seed script for 10,000 users and 2,000 teams, and a load test (k6 or autocannon) showing p95 under 200 ms on the board endpoint with 100 concurrent users



## Notes

Remember, the main goal is to build a race proof, production-grade team-formation service for a hackathon with 10,000 participants.

Also, whatever code we write, should be step by step and very modular so it can be easily reviewed and checked and we have control over every feature/fix we write code for.


## Tech Stack

- Frontend + Backend: Next JS, TypeScript, Bun, Postgres, Prisma, ShadCN
- Cache + Pub/Sub: Redis
- Docker for containerization
- Auth: Better Auth