-- 샘플 데이터 지우기 (make_sample.py 가 만든 것만)
begin;
delete from gm.notifications where project_id = '8e7cc797-38e6-5951-a957-b3028c7e0578';
delete from gm.deliveries where id in ('ac6fa675-44f8-573a-97b0-e05f81ecfdf9', '95b3d69b-120d-5db3-83c2-e854007cfe9b', 'c9ba5175-3833-5e8d-a778-337ffc32ab5a', 'a9cc5d08-c8df-5010-a3ed-2522f2148eb9', 'e55a15d4-7b80-578e-8d63-617133428103', '1fa8bdc5-2445-5845-83e9-ae0b6a14bd92');
delete from gm.products where id in ('7c8227f5-cb2d-5ec9-bbcc-dfa8e11d018f', 'c7475534-8fc6-5d8d-9d77-3f7e21c2b739', 'fc3dd1b6-a55f-514a-a118-1aed92dec169');
delete from gm.projects where id = '8e7cc797-38e6-5951-a957-b3028c7e0578';
commit;
