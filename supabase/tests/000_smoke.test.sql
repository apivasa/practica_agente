begin;
select plan(1);
select ok(true, 'db viva');
select * from finish();
rollback;
